import { spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { paths } from '../paths'

/**
 * 联机支持：内置 Terracotta（陶瓦联机）——基于 EasyTier 的 P2P 虚拟局域网。
 *
 * 许可证：Terracotta 为 AGPL-3.0 **附例外条款**：打包未修改的二进制、或通过其本地
 * HTTP API 调用并在界面标注版权，不会传染我们的许可证。界面上必须写明「联机能力由
 * Terracotta | 陶瓦联机 提供」。
 *
 * 运行模型：
 *   terracotta.exe --hmcl <portFile>   → 进程把 {"port":N} 写进文件后作为服务运行
 *   GET http://127.0.0.1:N/meta        → 版本信息
 *   GET http://127.0.0.1:N/state       → 房间状态（500ms 轮询，index 单调递增）
 *   GET /state/scanning?player=&room=  → 房主开始扫描并建房
 *   GET /state/guesting?room=&player=  → 房客按邀请码加入
 *   GET /state/ide                     → 回到待机（关闭房间/退出）
 */

export const TERRACOTTA_VERSION = '0.4.2'
const WIN_PKG = `terracotta-${TERRACOTTA_VERSION}-windows-x86_64-pkg.tar.gz`
const WIN_PKG_SHA256 = '07ebe139e3ca5f74576e58b1a96efe59abdfbe148d3f1a49bfdca8b6f70745f0'
const WIN_EXE_SHA256 = '74c10568a7fea9c1d38cf8d2d4ca90baf1517f8e5a26c63d3349db70bc449796'

/** 下载源：优先 Gitee 镜像（国内直连），失败再试 GitHub */
const SOURCES = [
  `https://gitee.com/burningtnt/Terracotta/releases/download/v${TERRACOTTA_VERSION}/${WIN_PKG}`,
  `https://github.com/burningtnt/Terracotta/releases/download/v${TERRACOTTA_VERSION}/${WIN_PKG}`
]

export interface MpState {
  state: string
  index: number
  room?: string
  profiles?: { machine_id?: string; name?: string; kind?: string }[]
  difficulty?: string
  profile_index?: number
}

export interface MpStatus {
  installed: boolean
  running: boolean
  port: number
  version?: string
  easytier?: string
  room?: string
  state: string
  index: number
  members: { name: string; kind?: string }[]
  difficulty?: string
  message?: string
}

function toolDir(): string {
  return join(paths.root(), 'tools', 'terracotta', TERRACOTTA_VERSION)
}
function exePath(): string {
  return join(toolDir(), `terracotta-${TERRACOTTA_VERSION}-windows-x86_64.exe`)
}
function portFile(): string {
  return join(paths.root(), 'tools', 'terracotta', '.port.json')
}

export function isInstalled(): boolean {
  return existsSync(exePath())
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** 下载并解包 Terracotta（带哈希校验）；onProgress 报告百分比 */
export async function ensureTerracotta(onProgress?: (msg: string, pct?: number) => void): Promise<{ ok: boolean; message?: string }> {
  if (isInstalled()) return { ok: true }
  mkdirSync(toolDir(), { recursive: true })
  const cacheFile = join(toolDir(), WIN_PKG)

  let lastErr = ''
  if (!existsSync(cacheFile)) {
    for (const url of SOURCES) {
      try {
        onProgress?.('正在下载联机组件（Terracotta）…')
        const res = await fetch(url, { redirect: 'follow' })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const total = Number(res.headers.get('content-length') || 0)
        const chunks: Buffer[] = []
        let got = 0
        // @ts-expect-error Node 18+ ReadableStream 在类型里不一定有 asyncIterator
        for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
          chunks.push(Buffer.from(chunk))
          got += chunk.length
          if (total) onProgress?.(`正在下载联机组件… ${Math.round((got / total) * 100)}%`, (got / total) * 100)
        }
        const buf = Buffer.concat(chunks)
        const digest = sha256(buf)
        if (digest !== WIN_PKG_SHA256) {
          lastErr = `校验不通过（期望 ${WIN_PKG_SHA256.slice(0, 12)}…，实际 ${digest.slice(0, 12)}…）`
          continue
        }
        writeFileSync(cacheFile, buf)
        lastErr = ''
        break
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }
    if (!existsSync(cacheFile)) {
      return { ok: false, message: '下载联机组件失败：' + (lastErr || '未知错误') }
    }
  }

  onProgress?.('正在解包联机组件…')
  try {
    const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    const r = spawn(tar, ['-xzf', cacheFile, '-C', toolDir()], { windowsHide: true })
    const code = await new Promise<number>((resolve) => {
      r.on('exit', (c) => resolve(c ?? -1))
      r.on('error', () => resolve(-1))
    })
    if (code !== 0) throw new Error('解包失败（tar 退出码 ' + code + '）')
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }

  if (!existsSync(exePath())) {
    // 解包后文件名可能不带版本号，做一次兜底重命名
    try {
      const found = readdirSync(toolDir()).find((f) => /^terracotta-.*\.exe$/i.test(f))
      if (found) renameSync(join(toolDir(), found), exePath())
    } catch {
      /* ignore */
    }
  }
  if (!existsSync(exePath())) return { ok: false, message: '解包后没有找到 terracotta.exe' }

  try {
    const digest = sha256(readFileSync(exePath()))
    if (digest !== WIN_EXE_SHA256) {
      onProgress?.('注意：组件哈希与已知版本不一致（可能不是官方构建）')
    }
  } catch {
    /* ignore */
  }
  try {
    rmSync(cacheFile, { force: true })
  } catch {
    /* ignore */
  }
  return { ok: true }
}

/* ───────────── 运行时：进程 + HTTP 控制 ───────────── */

let child: ChildProcess | null = null
let port = 0
let meta: { version?: string; easytier_version?: string } = {}
let timer: NodeJS.Timeout | null = null
let last: MpState = { state: 'stopped', index: 0 }
let onStateCb: ((s: MpStatus) => void) | null = null

function statusOf(): MpStatus {
  return {
    installed: isInstalled(),
    running: port > 0,
    port,
    version: meta.version,
    easytier: meta.easytier_version,
    room: last.room,
    state: last.state,
    index: last.index,
    members: (last.profiles ?? []).map((p) => ({ name: p.name || '玩家', kind: p.kind })),
    difficulty: last.difficulty
  }
}

function emit(): void {
  onStateCb?.(statusOf())
}

export function onStatus(cb: (s: MpStatus) => void): void {
  onStateCb = cb
}

async function api(path: string): Promise<Record<string, unknown> | null> {
  if (!port) return null
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return null
    const txt = await res.text()
    try {
      return JSON.parse(txt) as Record<string, unknown>
    } catch {
      // /state/scanning 与 /state/guesting 成功时返回空 body（不是 JSON）
      return {}
    }
  } catch {
    return null
  }
}

async function poll(): Promise<void> {
  const s = await api('/state')
  if (!s) {
    // 服务没了
    if (port) {
      port = 0
      last = { state: 'stopped', index: 0 }
      emit()
    }
    return
  }
  const idx = Number(s.index ?? 0)
  if (idx !== last.index || s.state !== last.state) {
    last = {
      state: String(s.state ?? 'unknown'),
      index: idx,
      room: (s.room as string) || last.room,
      profiles: (s.profiles as MpState['profiles']) ?? [],
      difficulty: (s.difficulty as string) || undefined,
      profile_index: Number(s.profile_index ?? 0)
    }
    emit()
  }
}

/** 启动 Terracotta 服务（已运行则直接复用） */
export async function start(): Promise<{ ok: boolean; message?: string }> {
  if (port) return { ok: true }
  if (!isInstalled()) {
    const r = await ensureTerracotta()
    if (!r.ok) return r
  }
  mkdirSync(join(paths.root(), 'tools', 'terracotta'), { recursive: true })
  const pf = portFile()
  try {
    rmSync(pf, { force: true })
  } catch {
    /* ignore */
  }
  // --hmcl 是引导模式：会 fork 真正的服务工作进程，并把端口写进文件
  child = spawn(exePath(), ['--hmcl', pf], {
    cwd: toolDir(),
    windowsHide: true,
    stdio: 'ignore'
  })
  child.on('exit', () => {
    child = null
  })

  // 等待端口文件（最多 12 秒）
  const deadline = Date.now() + 12000
  let p = 0
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250))
    try {
      if (existsSync(pf)) {
        const j = JSON.parse(readFileSync(pf, 'utf-8')) as { port?: number }
        if (j.port) {
          p = j.port
          break
        }
      }
    } catch {
      /* 文件可能正在写 */
    }
  }
  if (!p) return { ok: false, message: '联机服务启动超时（没拿到端口）' }

  port = p
  const m = await api('/meta')
  meta = { version: m?.version as string, easytier_version: m?.easytier_version as string }

  if (timer) clearInterval(timer)
  timer = setInterval(() => void poll(), 500)
  await poll()
  return { ok: true }
}

/** 房主：开始扫描本机 MC 端口并创建房间 */
export async function host(player: string): Promise<{ ok: boolean; message?: string }> {
  const st = await start()
  if (!st.ok) return st
  const r = await api('/state/scanning?player=' + encodeURIComponent(player || 'Player'))
  return r === null ? { ok: false, message: '联机服务没有响应' } : { ok: true }
}

/** 房客：按邀请码加入房间 */
export async function joinRoom(code: string, player: string): Promise<{ ok: boolean; message?: string }> {
  const st = await start()
  if (!st.ok) return st
  const clean = normalizeCode(code)
  if (!clean) return { ok: false, message: '邀请码格式不对（应形如 U/XXXX-XXXX-XXXX-XXXX）' }
  const r = await api(
    '/state/guesting?room=' + encodeURIComponent(clean) + '&player=' + encodeURIComponent(player || 'Player')
  )
  return r === null ? { ok: false, message: '联机服务没有响应' } : { ok: true }
}

/** 回到待机：关闭房间 / 取消加入 */
export async function idle(): Promise<void> {
  await api('/state/ide')
  last = { state: 'waiting', index: last.index + 1 }
  emit()
}

/** 完全停止服务（启动器退出时调用） */
export async function stop(): Promise<void> {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  try {
    await api('/state/ide')
  } catch {
    /* ignore */
  }
  try {
    child?.kill()
  } catch {
    /* ignore */
  }
  child = null
  port = 0
  last = { state: 'stopped', index: 0 }
  emit()
}

/** 把用户输入整理成标准邀请码（容忍空格、小写、缺短横线） */
export function normalizeCode(input: string): string | null {
  const s = (input || '').toUpperCase().replace(/[^0-9A-Z/]/g, '')
  const m = s.match(/U\/?([0-9A-Z]{16})/)
  if (!m) return null
  const body = m[1].replace(/I/g, '1').replace(/O/g, '0')
  return 'U/' + body.slice(0, 4) + '-' + body.slice(4, 8) + '-' + body.slice(8, 12) + '-' + body.slice(12, 16)
}

export function currentStatus(): MpStatus {
  return statusOf()
}

/** 二进制信息（供界面显示版本与来源） */
export function binaryInfo(): { path: string; exists: boolean; sizeMB: number } {
  const p = exePath()
  try {
    return { path: p, exists: existsSync(p), sizeMB: Math.round((statSync(p).size / 1048576) * 10) / 10 }
  } catch {
    return { path: p, exists: false, sizeMB: 0 }
  }
}
