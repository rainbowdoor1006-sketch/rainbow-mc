import { app } from 'electron'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import { spawn } from 'child_process'
import { paths, installRoot } from './paths'
import { verifyManifest } from './minecraft/update'

/** 版本号口径必须与服务端一致：MAJOR * 100 + MINOR * 10 + PATCH */
export function versionCodeOf(version: string): number {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!m) return 0
  return Number(m[1]) * 100 + Number(m[2]) * 10 + Number(m[3])
}

export function localVersion(): string {
  // 仅测试用：用环境变量模拟本地版本号，验证「落后 / 超前」两条弹窗路径
  const fake = process.env['RAINBOW_FAKE_LOCAL_VERSION']
  if (fake && /^\d+\.\d+\.\d+$/.test(fake)) return fake
  return app.getVersion()
}

export function localVersionCode(): number {
  return versionCodeOf(localVersion())
}

/** 语义化版本比较：-1 / 0 / 1（比数字 code 更可靠，不受 versionCode 公式影响） */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number(x) || 0)
  const pb = b.split('.').map((x) => Number(x) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}
// 测试 / 自建服务器可用环境变量覆盖（仅影响更新地址，不改变验签逻辑）
export const UPDATE_ENDPOINT =
  process.env['RM_UPDATE_ENDPOINT'] || 'https://rainbowdoor.icu/api/launcher/version'

export interface LatestInfo {
  version: string
  versionCode: number
  downloadUrl: string
  sha256: string
  size: number
  notes?: string
  mandatory?: boolean
  minSupported?: string
  publishedAt?: string
  /** 清单签名（base64，Ed25519），对 version/sha256/size/downloadUrl 计算 */
  sig?: string
}

export type UpdateState = 'older' | 'same' | 'newer' | 'unknown'

export interface CheckResult {
  ok: boolean
  state: UpdateState
  local: { version: string; code: number }
  latest?: LatestInfo
  channel: string
  message?: string
}

function normalizeLatest(raw: Record<string, unknown> | undefined): LatestInfo | null {
  if (!raw) return null
  const version = String(raw.version ?? '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null
  const code = Number(raw.versionCode ?? versionCodeOf(version))
  const url = String(raw.downloadUrl ?? '')
  if (!/^https:\/\//i.test(url)) return null
  return {
    version,
    versionCode: Number.isFinite(code) ? code : versionCodeOf(version),
    downloadUrl: url,
    sha256: String(raw.sha256 ?? '').toLowerCase(),
    size: Number(raw.size ?? 0),
    notes: raw.notes ? String(raw.notes) : undefined,
    mandatory: Boolean(raw.mandatory),
    minSupported: raw.minSupported ? String(raw.minSupported) : undefined,
    publishedAt: raw.publishedAt ? String(raw.publishedAt) : undefined,
    sig: raw.sig ? String(raw.sig) : undefined
  }
}

/** 查询最新版本；任何异常都返回 unknown，绝不抛错、绝不阻塞启动 */
export async function checkForUpdate(channel = 'stable'): Promise<CheckResult> {
  const local = { version: localVersion(), code: localVersionCode() }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(UPDATE_ENDPOINT, {
      headers: {
        'User-Agent': `RAINBOWMC/${local.version} (${process.platform}; ${process.arch})`,
        'X-Launcher-Channel': channel,
        Accept: 'application/json'
      },
      signal: ctrl.signal
    })
    if (!res.ok) return { ok: false, state: 'unknown', local, channel, message: `HTTP ${res.status}` }
    const data = (await res.json()) as Record<string, unknown>
    if (!data.ok) {
      // E9101 = 该渠道没有版本，视为「无需更新」
      return { ok: true, state: 'same', local, channel }
    }
    const latest = normalizeLatest(data.latest as Record<string, unknown> | undefined)
    if (!latest) return { ok: false, state: 'unknown', local, channel, message: '版本信息不完整' }
    // 先验签：清单由服务器返回，sha256 也在里面，同源就等于没有校验。
    // 公钥内置在程序里，攻击者必须拿到私钥才能伪造，服务器被拿下也推不了恶意包。
    const sigErr = verifyManifest({
      version: latest.version,
      sha256: latest.sha256,
      size: latest.size,
      downloadUrl: latest.downloadUrl,
      sig: latest.sig
    })
    if (sigErr) {
      return { ok: false, state: 'unknown', local, channel, message: sigErr }
    }
    // 用语义化版本比较，而不是 versionCode：
    // code 的公式（MAJOR*100+MINOR*10+PATCH）在 0.3.0 这种场景会倒退，
    // 版本号本身比较永远单调，服务端换公式也不受影响。
    const cmp = compareVersion(latest.version, local.version)
    const state: UpdateState = cmp > 0 ? 'older' : cmp < 0 ? 'newer' : 'same'
    return { ok: true, state, local, latest, channel }
  } catch (e) {
    return {
      ok: false,
      state: 'unknown',
      local,
      channel,
      message: e instanceof Error ? e.message : String(e)
    }
  } finally {
    clearTimeout(timer)
  }
}

function sha256File(file: string): string {
  const h = createHash('sha256')
  h.update(readFileSync(file))
  return h.digest('hex')
}

export interface DownloadResult {
  ok: boolean
  path?: string
  message?: string
}

/** 下载安装包到临时目录，校验 sha256；带进度回调 */
export async function downloadInstaller(
  latest: LatestInfo,
  onProgress?: (loaded: number, total: number) => void
): Promise<DownloadResult> {
  const dir = join(paths.cache(), 'updates')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `RAINBOWMC-${latest.version}-setup.exe`)
  try {
    if (existsSync(file) && latest.size && statSync(file).size === latest.size) {
      if (!latest.sha256 || sha256File(file) === latest.sha256) return { ok: true, path: file }
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10 * 60 * 1000)
    const resumeFrom = existsSync(file) ? statSync(file).size : 0
    const headers: Record<string, string> = { 'User-Agent': `RAINBOWMC/${localVersion()}` }
    if (resumeFrom > 0 && latest.size > resumeFrom) headers.Range = `bytes=${resumeFrom}-`
    const res = await fetch(latest.downloadUrl, { headers, signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok || !res.body) return { ok: false, message: `下载失败 HTTP ${res.status}` }
    const total = Number(res.headers.get('content-length') || latest.size || 0) + (res.status === 206 ? resumeFrom : 0)
    const out = createWriteStream(file, { flags: res.status === 206 ? 'a' : 'w' })
    let loaded = res.status === 206 ? resumeFrom : 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.write(Buffer.from(value))
      loaded += value.length
      onProgress?.(loaded, total || latest.size || 0)
    }
    await new Promise<void>((resolve) => out.end(resolve))
    if (latest.sha256 && sha256File(file) !== latest.sha256) {
      try {
        unlinkSync(file)
      } catch {
        /* ignore */
      }
      return { ok: false, message: '安装包校验失败（sha256 不匹配），已删除' }
    }
    return { ok: true, path: file }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** 运行安装程序：静默、保留 data、装到当前目录 */
/**
 * 启动安装程序。
 * 注意：NSIS 静默安装会主动结束正在运行的启动器进程，所以这里「只负责拉起安装器」，
 * 随后调用方会立刻退出自己；安装完成后由安装脚本负责重新启动启动器。
 */
export function runInstaller(installerPath: string): { ok: boolean; message?: string } {
  const dir = installRoot()
  // 静默安装：不给用户增加点击步骤；装完由 installer.nsh 的 Silent 分支自动拉起启动器。
  // （前提：启动器必须先退出，否则 data/ 被占用会导致搬迁退化——见 runInstaller 注释）
  const args = ['/S', '/KEEPDATA']
  if (dir) args.push(`/D=${dir}`)
  // 直接拉起安装程序；调用方会在 ~1.5 秒后退出启动器，
  // 等安装程序真正开始搬 data/ 时，这边的文件句柄已经释放了。
  // （不要用 cmd 包一层：Node 给带空格的参数加引号会把 & 分隔的命令搞坏）
  try {
    // windowsVerbatimArguments：NSIS 的 /D= 后面必须是「原样未加引号」的路径，
    // Node 默认会给含空格的参数加引号，导致 /D 被截断或失效，装到错误目录。
    spawn(installerPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true
    }).unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 安装完成后重启自己。
 * 不能只依赖 app.relaunch()：exe 刚被安装程序替换，文件句柄可能还没释放，
 * 所以这里用 detached spawn 直接拉起新进程，再退出当前进程。
 */
export function restartAfterUpdate(): void {
  const exe = app.getPath('exe')
  // 交给 cmd 延迟 3 秒再 start：确保安装程序彻底释放 exe / app.asar 的文件句柄，
  // 否则新进程会因为文件被占用而立刻退出。
  const cmd = `ping -n 4 127.0.0.1 >nul & start "" "${exe}"`
  try {
    spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    app.relaunch()
  }
  setTimeout(() => app.exit(0), 800)
}
