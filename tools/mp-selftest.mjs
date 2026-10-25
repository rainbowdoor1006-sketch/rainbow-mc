/**
 * 联机功能自测：单机模拟两个玩家（房主 + 房客）
 *
 * 原理：
 *  1. Terracotta「房主扫描」是监听 Minecraft 的局域网广播（UDP 224.0.2.60:4445），
 *     所以这里用脚本伪造一条局域网公告（AD=25565），不需要真的开游戏世界。
 *  2. Terracotta 的单实例锁在 %TEMP%\terracotta\terracotta.lock，
 *     通过给两个进程设置不同的 TEMP，就能在同机跑两个互相独立的实例。
 *  3. 房主实例调用 /state/scanning 建房，房客实例调用 /state/guesting 用邀请码加入，
 *     然后轮询两边 /state，看是否走到 host-ok / guest-ok。
 *
 * 用法：node tools\mp-selftest.mjs
 */
import { spawn } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'D:\\Temp\\tt'
const EXE = join(BASE, 'terracotta.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function prep() {
  mkdirSync(BASE, { recursive: true })
  for (const d of ['host', 'guest']) mkdirSync(join(BASE, d), { recursive: true })
  const src = join(BASE, 'terracotta-0.4.2-windows-x86_64.exe')
  if (!existsSync(EXE)) copyFileSync(src, EXE)
  const vc = join(BASE, 'VCRUNTIME140.DLL')
  for (const d of ['host', 'guest']) {
    if (existsSync(vc)) copyFileSync(vc, join(BASE, d, 'VCRUNTIME140.DLL'))
  }
}

/** 伪造 Minecraft 局域网广播 */
function fakeLanBroadcast() {
  const sock = createSocket({ type: 'udp4', reuseAddr: true })
  const payload = Buffer.from('[MOTD]RAINBOWMC-TEST[/MOTD][AD]25565[/AD][ST]Survival[/ST]', 'utf8')
  sock.bind(() => {
    sock.setMulticastTTL(1)
    sock.addMembership('224.0.2.60')
  })
  const timer = setInterval(() => {
    try {
      sock.send(payload, 4445, '224.0.2.60')
    } catch {
      /* ignore */
    }
  }, 400)
  return () => {
    clearInterval(timer)
    try {
      sock.close()
    } catch {
      /* ignore */
    }
  }
}

async function startInstance(name, dir) {
  const portFile = join(BASE, name + '.port.json')
  rmSync(portFile, { force: true })
  const proc = spawn(EXE, ['--hmcl', portFile], {
    cwd: dir,
    env: { ...process.env, TEMP: dir, TMP: dir },
    windowsHide: true,
    stdio: 'ignore'
  })
  const deadline = Date.now() + 15000
  let port = 0
  while (Date.now() < deadline) {
    await sleep(300)
    try {
      const j = JSON.parse(readFileSync(portFile, 'utf-8'))
      if (j.port) {
        port = j.port
        break
      }
    } catch {
      /* 还没写 */
    }
  }
  return { name, port, proc, base: `http://127.0.0.1:${port}` }
}

async function get(inst, path) {
  try {
    const res = await fetch(inst.base + path, { signal: AbortSignal.timeout(5000) })
    const txt = await res.text()
    try {
      return JSON.parse(txt)
    } catch {
      return { raw: txt }
    }
  } catch (e) {
    return { error: String(e) }
  }
}

async function waitState(inst, want, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const s = await get(inst, '/state')
    last = s
    if (s && s.state === want) return s
    if (s && s.state === 'exception') return s
    await sleep(700)
  }
  return last
}

const results = []
function log(...a) {
  const line = a.join(' ')
  console.log(line)
  results.push(line)
}

async function main() {
  prep()
  log('· 开启伪造的局域网广播（AD=25565）')
  const stopBroadcast = fakeLanBroadcast()
  await sleep(800)

  log('· 启动房主实例…')
  const host = await startInstance('host', join(BASE, 'host'))
  log(`  房主端口 ${host.port || '(未拿到)'}`)
  if (!host.port) throw new Error('房主实例没有起来')

  const meta = await get(host, '/meta')
  log(`  版本 ${meta.version} / easytier ${meta.easytier_version}`)

  log('· 房主创建房间…')
  await get(host, '/state/scanning?player=HostA')
  const hostOk = await waitState(host, 'host-ok', 60000)
  log(`  房主状态：${hostOk?.state || '无响应'}${hostOk?.room ? '  邀请码 ' + hostOk.room : ''}`)
  if (!hostOk?.room) {
    log('  ✗ 没拿到邀请码，自测终止')
    await cleanup(host, null, stopBroadcast)
    return
  }

  log('· 启动房客实例…')
  const guest = await startInstance('guest', join(BASE, 'guest'))
  log(`  房客端口 ${guest.port || '(未拿到)'}`)
  if (!guest.port) throw new Error('房客实例没有起来')

  log('· 房客用邀请码加入…')
  await get(guest, '/state/guesting?room=' + encodeURIComponent(hostOk.room) + '&player=GuestB')
  let guestState = null
  const deadline = Date.now() + 150000
  while (Date.now() < deadline) {
    const s = await get(guest, '/state')
    if (s && s.state !== guestState?.state) {
      guestState = s
      log('  [房客] ' + s.state + (s.difficulty ? ' / ' + s.difficulty : ''))
    }
    if (s && (s.state === 'guest-ok' || s.state === 'exception')) { guestState = s; break }
    await sleep(2000)
  }
  log(`  房客状态：${guestState?.state || '无响应'}`)

  const hostAfter = await get(host, '/state')
  log(`  房主侧成员数：${(hostAfter?.profiles || []).length}（${(hostAfter?.profiles || []).map((p) => p.name).join(', ')}）`)

  const pass = guestState?.state === 'guest-ok'
  log(pass ? '✅ 自测通过：房间创建 + 邀请码加入 全流程走通' : '❌ 自测未通过')
  await cleanup(host, guest, stopBroadcast)
}

async function cleanup(host, guest, stopBroadcast) {
  try {
    if (host) await get(host, '/state/ide')
    if (guest) await get(guest, '/state/ide')
  } catch {
    /* ignore */
  }
  await sleep(500)
  for (const p of [host?.proc, guest?.proc]) {
    try {
      p?.kill()
    } catch {
      /* ignore */
    }
  }
  stopBroadcast()
  await sleep(500)
  console.log('· 已清理测试实例')
}

main().catch(async (e) => {
  console.error('测试异常：', e.message)
  process.exit(1)
})
