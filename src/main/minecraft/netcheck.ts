import { createSocket } from 'dgram'
import { networkInterfaces } from 'os'
import { connect } from 'net'

/**
 * 联机网络体检。
 *
 * 目的：在用户点「开房 / 加入」之前，把「能不能直连、直连大概多快」算出来，
 * 并给出可执行的建议（开 IPv6 / 关代理 / 换网络 / 别用中继）。
 *
 * 全部在本机做，不需要我们自己的服务器：
 *   · 网卡与 IPv6：读系统
 *   · NAT 类型：STUN（UDP 打洞原理，两个 STUN 服务器比对映射端口）
 *   · 延迟：对公共节点做 TCP 连接计时
 *   · 带宽：从国内镜像下一个固定大小文件测速
 */

export interface IfaceInfo {
  name: string
  ipv4: string[]
  ipv6: string[]
  internal: boolean
}

export interface StunResult {
  ok: boolean
  mapped?: string
  natType: 'open' | 'cone' | 'symmetric' | 'blocked' | 'unknown'
  note: string
}

export interface LatencyItem {
  name: string
  host: string
  port: number
  ms: number | null
}

export interface SpeedResult {
  ok: boolean
  mbps: number
  ms: number
  bytes: number
  error?: string
}

export interface NetReport {
  ifaces: IfaceInfo[]
  hasIpv6: boolean
  /** 公网 IP 与运营商（能查到就显示，查不到留空） */
  publicIp?: string
  isp?: string
  stun: StunResult
  latencies: LatencyItem[]
  bestNode?: LatencyItem
  speed?: SpeedResult
  /** 0~100 的直连可行性评分 */
  score: number
  level: 'great' | 'ok' | 'poor' | 'bad'
  suggestions: string[]
  checkedAt: number
}

/* ─────────── 网卡 ─────────── */

export function listIfaces(): IfaceInfo[] {
  const out: IfaceInfo[] = []
  const all = networkInterfaces()
  for (const [name, list] of Object.entries(all)) {
    if (!list) continue
    const v4: string[] = []
    const v6: string[] = []
    let internal = true
    for (const a of list) {
      if (a.family === 'IPv4') {
        v4.push(a.address)
        if (!a.internal) internal = false
      } else if (String(a.family) === 'IPv6') {
        if (!a.address.startsWith('fe80')) v6.push(a.address)
        if (!a.internal) internal = false
      }
    }
    out.push({ name, ipv4: v4, ipv6: v6, internal })
  }
  return out.filter((i) => !i.internal || i.ipv4.some((ip) => !ip.startsWith('127.')))
}

/* ─────────── STUN（判断 NAT 类型 / UX） ─────────── */

const STUN_SERVERS: { host: string; port: number }[] = [
  { host: 'stun.miwifi.com', port: 3478 },
  { host: 'stun.chat.bilibili.com', port: 3478 },
  { host: 'stun.l.google.com', port: 19302 }
]

function stunRequest(host: string, port: number, timeoutMs = 2500): Promise<{ ip: string; port: number }> {
  return new Promise((resolve, reject) => {
    const sock = createSocket('udp4')
    const tid = Buffer.alloc(12)
    for (let i = 0; i < 12; i++) tid[i] = Math.floor(Math.random() * 256)
    // STUN Binding Request: type 0x0001, length 0, magic cookie 0x2112A442 + 12 字节 tid
    const msg = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x00, 0x00, 0x21, 0x12, 0xa4, 0x42]),
      tid
    ])
    let done = false
    const finish = (err?: Error, val?: { ip: string; port: number }): void => {
      if (done) return
      done = true
      try {
        sock.close()
      } catch {
        /* ignore */
      }
      if (err) reject(err)
      else resolve(val as { ip: string; port: number })
    }
    const timer = setTimeout(() => finish(new Error('STUN 超时')), timeoutMs)
    sock.on('message', (buf) => {
      clearTimeout(timer)
      try {
        if (buf.length < 32) return finish(new Error('响应过短'))
        // 遍历属性找 XOR-MAPPED-ADDRESS(0x0020) 或 MAPPED-ADDRESS(0x0001)
        let off = 20
        while (off + 4 <= buf.length) {
          const type = buf.readUInt16BE(off)
          const len = buf.readUInt16BE(off + 2)
          const val = buf.subarray(off + 4, off + 4 + len)
          if ((type === 0x0020 || type === 0x0001) && val.length >= 8) {
            const port = type === 0x0020 ? val.readUInt16BE(2) ^ 0x2112 : val.readUInt16BE(2)
            let ip: string
            if (type === 0x0020) {
              const x = Buffer.from(val.subarray(4, 8))
              x[0] ^= 0x21
              x[1] ^= 0x12
              x[2] ^= 0xa4
              x[3] ^= 0x42
              ip = Array.from(x).join('.')
            } else {
              ip = Array.from(val.subarray(4, 8)).join('.')
            }
            return finish(undefined, { ip, port })
          }
          off += 4 + len + ((4 - (len % 4)) % 4)
        }
        finish(new Error('没有 MAPPED-ADDRESS'))
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)))
      }
    })
    sock.on('error', (e) => finish(e))
    sock.send(msg, port, host, (err) => {
      if (err) finish(err)
    })
  })
}

async function detectNat(): Promise<StunResult> {
  const results: { ip: string; port: number }[] = []
  for (const s of STUN_SERVERS) {
    try {
      const r = await stunRequest(s.host, s.port)
      if (r?.ip) results.push(r)
    } catch {
      /* 换下一个 */
    }
    if (results.length >= 2) break
  }
  if (!results.length) {
    return { ok: false, natType: 'blocked', note: 'STUN 无响应：UDP 可能被防火墙/代理拦截' }
  }
  const [a, b] = results
  if (b && a.port !== b.port) {
    return {
      ok: true,
      mapped: `${a.ip}:${a.port}`,
      natType: 'symmetric',
      note: '对称型 NAT：不同目标映射到不同端口，打洞成功率低（约 20~40%）'
    }
  }
  if (a.ip && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.ip)) {
    return { ok: true, mapped: `${a.ip}:${a.port}`, natType: 'blocked', note: '映射到内网地址：说明有二次 NAT，打洞困难' }
  }
  return {
    ok: true,
    mapped: `${a.ip}:${a.port}`,
    natType: b ? 'cone' : 'open',
    note: b ? '锥形 NAT：打洞成功率较高（约 80%）' : '只测到一个 STUN，按开放 NAT 处理'
  }
}

/* ─────────── 延迟 ─────────── */

const NODES: { name: string; host: string; port: number }[] = [
  { name: 'EasyTier 主节点', host: 'public.easytier.top', port: 11010 },
  { name: 'EasyTier 国内节点', host: 'public2.easytier.cn', port: 54321 },
  { name: '阿里 DNS', host: '223.5.5.5', port: 53 },
  { name: '腾讯 DNS', host: '119.29.29.29', port: 53 }
]

function tcpLatency(host: string, port: number, timeoutMs = 2000): Promise<number | null> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const sock = connect({ host, port })
    let settled = false
    const done = (v: number | null): void => {
      if (settled) return
      settled = true
      try {
        sock.destroy()
      } catch {
        /* ignore */
      }
      resolve(v)
    }
    sock.setTimeout(timeoutMs)
    sock.on('connect', () => done(Date.now() - t0))
    sock.on('timeout', () => done(null))
    sock.on('error', () => done(null))
  })
}

async function measureLatencies(): Promise<LatencyItem[]> {
  return Promise.all(
    NODES.map(async (n) => ({ name: n.name, host: n.host, port: n.port, ms: await tcpLatency(n.host, n.port) }))
  )
}

/* ─────────── 带宽测速 ─────────── */

const SPEED_URLS = [
  // 国内镜像上的固定文件（BMCLAPI 的 maven，通常是几 MB 的 jar）
  'https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-installer.jar',
  'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json'
]

export async function speedTest(): Promise<SpeedResult> {
  for (const url of SPEED_URLS) {
    try {
      const t0 = Date.now()
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 20000)
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'RAINBOWMC' } })
      if (!res.ok || !res.body) {
        clearTimeout(timer)
        continue
      }
      const reader = res.body.getReader()
      let got = 0
      const LIMIT = 8 * 1024 * 1024
      while (got < LIMIT) {
        const { done, value } = await reader.read()
        if (done) break
        got += value?.length ?? 0
      }
      try {
        await reader.cancel()
      } catch {
        /* ignore */
      }
      clearTimeout(timer)
      const sec = Math.max(0.15, (Date.now() - t0) / 1000)
      return { ok: true, mbps: Math.round((got / 1048576 / sec) * 10) / 10, ms: Date.now() - t0, bytes: got }
    } catch {
      /* 换下一个源 */
    }
  }
  return { ok: false, mbps: 0, ms: 0, bytes: 0, error: '测速源都不可用' }
}

/* ─────────── 公网 IP / 运营商 ─────────── */

async function fetchPublicIp(): Promise<{ ip?: string; isp?: string }> {
  const apis = ['https://myip.ipip.net/json', 'https://ipapi.co/json/', 'https://api.ip.sb/geoip']
  for (const u of apis) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 4000)
      const res = await fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': 'RAINBOWMC' } })
      clearTimeout(t)
      if (!res.ok) continue
      const j = (await res.json()) as Record<string, unknown>
      const ip = (j.ip as string) || (j.query as string) || ((j.data as Record<string, unknown>)?.ip as string)
      const isp =
        (j.isp as string) ||
        (j.org as string) ||
        (j.asn_org as string) ||
        ((j.data as Record<string, unknown>)?.isp as string) ||
        ''
      if (ip) return { ip, isp }
    } catch {
      /* 换下一个 */
    }
  }
  return {}
}

/* ─────────── 综合 ─────────── */

export async function checkNetwork(withSpeed = true): Promise<NetReport> {
  const ifaces = listIfaces()
  const hasIpv6 = ifaces.some((i) => i.ipv6.length > 0)
  const [stun, latencies, pub, speed] = await Promise.all([
    detectNat(),
    measureLatencies(),
    fetchPublicIp(),
    withSpeed ? speedTest() : Promise.resolve(undefined)
  ])

  const bestNode = latencies
    .filter((l) => l.ms !== null && l.name.startsWith('EasyTier'))
    .sort((a, b) => (a.ms ?? 9999) - (b.ms ?? 9999))[0]

  // 直连可行性评分
  let score = 50
  if (hasIpv6) score += 25
  if (stun.natType === 'cone' || stun.natType === 'open') score += 20
  if (stun.natType === 'symmetric') score -= 20
  if (stun.natType === 'blocked') score -= 35
  if (bestNode?.ms) {
    if (bestNode.ms < 60) score += 10
    else if (bestNode.ms > 200) score -= 10
  }
  score = Math.max(0, Math.min(100, score))
  const level: NetReport['level'] = score >= 80 ? 'great' : score >= 60 ? 'ok' : score >= 35 ? 'poor' : 'bad'

  const suggestions: string[] = []
  if (!hasIpv6) {
    suggestions.push('本机没有可用 IPv6。开启 IPv6 后联机几乎一定能直连（路由器里打开 IPv6 / 联系运营商开通）。')
  } else {
    suggestions.push('检测到 IPv6，联机会优先走 IPv6 直连，速度取决于双方宽带上限。')
  }
  if (stun.natType === 'symmetric') {
    suggestions.push('你在对称型 NAT 后面，打洞成功率低。建议：换手机热点 / 换到同一运营商网络，或让对方当房主。')
  }
  if (stun.natType === 'blocked') {
    suggestions.push('UDP 被拦截（可能有代理、防火墙或校园网限制）。联机会退到中继，延迟明显变高；关掉代理或换网络再试。')
  }
  if (stun.natType === 'cone') {
    suggestions.push('锥形 NAT，打洞成功率约 80%，多数情况可以直连。')
  }
  if (bestNode?.ms && bestNode.ms > 150) {
    suggestions.push(`到近期节点延迟 ${bestNode.ms} ms 偏高，联机时可能会卡；建议避开高峰或换网络。`)
  }
  if (withSpeed && speed) {
    if (!speed.ok) suggestions.push('带宽测速失败（测速源不可达），联机速度无法预估。')
    else if (speed.mbps < 2) suggestions.push(`下载速度只有 ${speed.mbps} MB/s，大整合包首次进服会等很久（区块传输吃带宽）。`)
    else if (speed.mbps >= 10) suggestions.push(`下载速度 ${speed.mbps} MB/s，带宽充足，大整合包也能带得动。`)
    else suggestions.push(`下载速度 ${speed.mbps} MB/s，普通整合包够用，500+ 模组的首次加载会慢一些。`)
  }
  suggestions.push('大整合包首次进服会传大量区块数据，建议房主先让朋友进一次、再重启房间，第二次会快很多。')

  return {
    ifaces,
    hasIpv6,
    publicIp: pub.ip,
    isp: pub.isp,
    stun,
    latencies,
    bestNode,
    speed,
    score,
    level,
    suggestions,
    checkedAt: Date.now()
  }
}
