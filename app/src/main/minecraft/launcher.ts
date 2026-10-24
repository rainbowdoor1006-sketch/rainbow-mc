import { spawn, type ChildProcess } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'
import type { AccountInfo, AppSettings, GameProject } from '@shared/types'
import type { MinecraftVersionJson } from '@shared/mclib'
import { getVersionJson, rulesAllow } from './installer'
import { paths } from '../paths'
import { findInstalledJava, ensureJava } from './java'
import { librariesDir, versionDir } from './paths'
import { getVersionJsonChain } from './versionchain'

export interface LaunchResult {
  ok: boolean
  code?: number
  logFile: string
  errorCode?: string
  message?: string
}

const PLACEHOLDER = /\$\{([a-zA-Z0-9_]+)\}/g

/** 自动分配内存：物理内存的 40%，夹在 2G–8G 之间，且不超过总量的一半 */
export function autoMemoryMb(): number {
  const total = require('os').totalmem() as number
  const half = total / 1024 / 1024 / 2
  return Math.max(2048, Math.min(8192, Math.min(half, (total / 1024 / 1024) * 0.4)))
}

export function totalMemoryMb(): number {
  return Math.round((require('os').totalmem() as number) / 1024 / 1024)
}

/** group:artifact:version[:classifier] → maven 相对路径 */
function mavenPathFromName(name: string): string | null {
  const parts = (name || '').split(':')
  if (parts.length < 3) return null
  const [group, artifact, version, classifier] = parts
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.jar`
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`
}

function nativesDir(versionId: string): string {  const dir = join(versionDir(versionId), 'natives')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 解压 natives jar 到版本目录（跳过 META-INF） */
function extractNatives(json: MinecraftVersionJson, versionId: string): string {
  const dir = nativesDir(versionId)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AdmZip = require('adm-zip') as typeof import('adm-zip')
  for (const lib of json.libraries || []) {
    if (!rulesAllow(lib.rules)) continue
    const nativesKey = lib.natives?.windows
    if (!nativesKey || !lib.downloads?.classifiers) continue
    const cls = lib.downloads.classifiers[nativesKey.replace('${arch}', '64')]
    if (!cls) continue
    const jar = join(librariesDir(), cls.path)
    if (!existsSync(jar)) continue
    try {
      const zip = new AdmZip(jar)
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        if (entry.entryName.startsWith('META-INF/')) continue
        const target = join(dir, entry.entryName.replace(/\//g, '\\'))
        mkdirSync(join(target, '..'), { recursive: true })
        writeFileSync(target, entry.getData())
      }
    } catch {
      /* 单个 natives 包失败不阻塞启动 */
    }
  }
  return dir
}

interface Ctx {
  [key: string]: string
}

function applyPlaceholders(value: string, ctx: Ctx): string {
  return value.replace(PLACEHOLDER, (m, key: string) => (key in ctx ? ctx[key] : m))
}

/** 组装 java 命令行（不含 java 可执行文件本身） */
export async function buildCommand(
  project: GameProject,
  account: AccountInfo,
  settings: AppSettings,
  javaExe: string
): Promise<{ args: string[]; mainClass: string; classpath: string; natives: string; versionId: string }> {
  const { json, versionId } = await getVersionJsonChain(
    project.versionId || project.mcVersion,
    settings.downloadSource
  )
  const gameDir = join(paths.games(), project.dir)
  mkdirSync(gameDir, { recursive: true })

  const libs: string[] = []
  for (const lib of json.libraries || []) {
    if (!rulesAllow(lib.rules)) continue
    const art = lib.downloads?.artifact
    if (art) {
      libs.push(join(librariesDir(), art.path))
      continue
    }
    // Fabric / Forge 的库常常只给 maven 坐标（name + url），按坐标推导路径
    const path = mavenPathFromName(lib.name)
    if (path) {
      const full = join(librariesDir(), path)
      if (existsSync(full)) libs.push(full)
    }
  }
  const jvmRaw = json.arguments?.jvm ?? []
  const usesModulePath = jvmRaw.some((a) => {
    const vals = typeof a === 'string' ? [a] : Array.isArray(a.value) ? a.value : [a.value]
    return vals.includes('-p') || vals.includes('--module-path')
  })

  // Forge / NeoForge 走模块路径：classpath 里只放改名后的 client-extra.jar，
  // 否则原始 <mc>.jar 会被当成自动模块，和 Forge 的 minecraft 模块撞包
  let classpath: string
  if (usesModulePath) {
    const extra = join(versionDir(versionId), 'client-extra.jar')
    const original = join(versionDir(versionId), `${versionId}.jar`)
    if (!existsSync(extra) && existsSync(original)) {
      try {
        require('fs').copyFileSync(original, extra)
      } catch {
        /* 复制失败就退回原始 jar */
      }
    }
    classpath = [...libs, existsSync(extra) ? extra : original].join(';')
  } else {
    classpath = [...libs, join(versionDir(versionId), `${versionId}.jar`)].join(';')
  }
  const natives = extractNatives(json, versionId)

  const mem = Math.max(1024, project.memoryMode === 'auto'
    ? Math.round(autoMemoryMb())
    : project.memoryMb || settings.maxMemoryMb)
  const ctx: Ctx = {
    auth_player_name: account.name,
    version_name: project.mcVersion,
    game_directory: gameDir,
    assets_root: join(paths.assets()),
    game_assets: join(paths.assets(), 'virtual', json.assetIndex?.id ?? json.assets ?? 'legacy'),
    assets_index_name: json.assetIndex?.id ?? json.assets ?? 'legacy',
    auth_uuid: account.uuid.replace(/-/g, ''),
    auth_access_token: account.accessToken || '0',
    user_type: 'legacy',
    version_type: json.type,
    natives_directory: natives,
    launcher_name: 'RAINBOWMC',
    launcher_version: app.getVersion(),
    classpath,
    classpath_separator: ';',
    library_directory: librariesDir(),
    clientid: '',
    auth_xuid: '',
    resolution_width: String(project.width || 854),
    resolution_height: String(project.height || 480)
  }

  const jvm: string[] = [`-Xmx${mem}M`, `-Xms${Math.min(1024, mem)}M`]
  const title = project.windowTitle || settings.windowTitle
  if (title) jvm.push(`-Dminecraft.window.title=${title}`)
  jvm.push(`-Djava.library.path=${natives}`)
  jvm.push('-Dminecraft.launcher.brand=RAINBOWMC', '-Dminecraft.launcher.version=0.1.0')
  jvm.push('-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8')
  // 部分模组会在构造阶段直接访问 GitHub raw / 自家接口，Java 默认连接超时是「无限」，
  // 在国内网络下会卡住整个模组加载（表现为启动卡死、无报错）。强制 5 秒超时让它快速失败。
  jvm.push('-Dsun.net.client.defaultConnectTimeout=5000', '-Dsun.net.client.defaultReadTimeout=5000')

  const argList = json.arguments?.jvm
  let hasModulePath = false
  if (argList) {
    for (const a of argList) {
      if (typeof a === 'string') {
        // -cp / ${classpath} 一律跳过，统一在末尾按固定顺序补齐，避免顺序错乱
        if (a === '-cp' || a === '-classpath' || a === '${classpath}' || a === '${classpath_separator}') continue
        if (a === '-p' || a === '--module-path') hasModulePath = true
        jvm.push(applyPlaceholders(a, ctx))
      } else {
        if (!rulesAllow(a.rules)) continue
        const val = Array.isArray(a.value) ? a.value : [a.value]
        for (const v of val) {
          if (v === '-cp' || v === '-classpath' || v === '${classpath}') continue
          if (v === '-p' || v === '--module-path') hasModulePath = true
          jvm.push(applyPlaceholders(v, ctx))
        }
      }
    }
  }
  // 实例级额外 JVM 参数
  if (/forge/i.test(project.loader)) {
    ensureForgeEarlyWindowOff(ctx.gameDir)
  }

  if (project.jvmArgs) {
    jvm.push(...project.jvmArgs.split(/\s+/).filter(Boolean))
  }

  // 注意：Forge 47.x（1.20.1）里**不存在** fml.earlyprogresswindow 这个属性，
  // 传了也没用（我反查过 fmlloader / fmlearlydisplay 的 class 常量池确认）。
  // 早期窗口崩溃只能用驱动/显卡层面的办法解决，见 ipc.ts 的 diagnoseCrash 提示。
  // 模块路径模式下 classpath 只有 client-extra.jar；普通版本是「所有库 + 客户端 jar」
  jvm.push('-cp', classpath)

  // 日志配置（老版本用）
  const loggingArg = json.logging?.client?.argument
  if (loggingArg) {
    const file = json.logging?.client?.file
    const logPath = file ? join(paths.assets(), 'log_configs', file.id) : ''
    if (file && logPath) {
      jvm.push(applyPlaceholders(loggingArg, { ...ctx, path: logPath }))
    }
  }

  const game: string[] = []
  if (json.arguments?.game) {
    for (const a of json.arguments.game) {
      if (typeof a === 'string') game.push(applyPlaceholders(a, ctx))
      else {
        if (!rulesAllow(a.rules)) continue
        const val = Array.isArray(a.value) ? a.value : [a.value]
        for (const v of val) game.push(applyPlaceholders(v, ctx))
      }
    }
  } else if (json.minecraftArguments) {
    for (const a of json.minecraftArguments.split(' ')) game.push(applyPlaceholders(a, ctx))
  }

  if (project.gameArgs) {
    game.push(...project.gameArgs.split(/\s+/).filter(Boolean))
  }
  if (project.joinServer) {
    game.push('--server', project.joinServer)
  }

  return {
    args: [...jvm, json.mainClass, ...game],
    mainClass: json.mainClass,
    classpath,
    natives,
    versionId
  }
}

export function debugArgs(args: string[]): string {
  return args.map((a, i) => `${i}: ${a.length > 300 ? a.slice(0, 300) + '…' : a}`).join('\n')
}

export interface LaunchHandle {
  proc: ChildProcess
  logFile: string
}

/** 启动游戏，返回进程与日志文件；日志实时落盘 */
export async function launchGame(
  project: GameProject,
  account: AccountInfo,
  settings: AppSettings,
  logFile: string,
  onLine: (line: string) => void,
  shouldAbort?: () => boolean
): Promise<LaunchHandle> {
  const abortIfNeeded = (): void => {
    if (shouldAbort?.()) throw new Error('已取消启动')
  }

  // 每个阶段都写日志：卡住时能看出卡在哪一步
  const log = (msg: string): void => {
    try {
      appendFileSync(logFile, `[启动器] ${msg}\n`)
    } catch {
      /* ignore */
    }
    onLine(`[启动器] ${msg}`)
  }

  /** 给可能卡住的步骤加超时 + 取消响应（每 300ms 检查一次） */
  const guard = async <T>(p: Promise<T>, label: string, timeoutMs: number): Promise<T> => {
    const t0 = Date.now()
    let tick: NodeJS.Timeout | null = null
    const watch = new Promise<T>((_, reject) => {
      tick = setInterval(() => {
        if (shouldAbort?.()) reject(new Error('已取消启动'))
        else if (Date.now() - t0 > timeoutMs) reject(new Error(`${label}超时（${Math.round(timeoutMs / 1000)} 秒）`))
      }, 300)
    })
    try {
      return await Promise.race([p, watch])
    } finally {
      if (tick) clearInterval(tick)
    }
  }

  log('正在读取版本文件…')
  const chain = await guard(
    getVersionJsonChain(project.versionId || project.mcVersion, settings.downloadSource),
    '读取版本文件',
    30000
  )
  abortIfNeeded()
  log(`版本文件已就绪：${project.versionId || project.mcVersion}`)
  const json = chain.json
  const major = json.javaVersion?.majorVersion ?? 8

  // 阶段追踪：日志里带时间和阶段号，崩溃时一眼看出停在哪一步
  const t0 = Date.now()
  const stage = (n: number, name: string, detail?: string): void => {
    log('▶ 阶段 ' + n + ': ' + name + (detail ? ' · ' + detail : '') + '（+' + (Date.now() - t0) + 'ms）')
  }
  stage(1, '版本文件就绪', (project.versionId || project.mcVersion) + ' / Java ' + major)

  let javaExe = project.javaPath || settings.javaPath
  if (!javaExe || !existsSync(javaExe)) {
    log(`正在查找 Java ${major}…`)
    const found = findInstalledJava(major)
    if (found) {
      javaExe = found
      log(`使用已安装的 Java：${found}`)
    } else {
      log(`本机没有 Java ${major}，开始下载运行时（首次较慢，请等待）…`)
      const r = await guard(ensureJava(major), '下载 Java 运行时', 300000)
      javaExe = r.path
      log(`Java 已就绪：${javaExe}`)
    }
  } else {
    log(`使用指定 Java：${javaExe}`)
  }
  stage(2, 'Java 已确定', javaExe)
  abortIfNeeded()

  stage(3, '解析依赖与 natives')
  const cmd = await guard(buildCommand(project, account, settings, javaExe), '解析依赖', 120000)
  abortIfNeeded()
  stage(4, '依赖就绪')
  if (process.env['RAINBOW_DEBUG_ARGS']) {
    console.log('=== ARGS ===')
    for (const a of cmd.args) console.log(a.length > 240 ? a.slice(0, 240) + '...' : a)
  }
  appendFileSync(logFile, `\n=== RAINBOW MC launch ===\njava: ${javaExe}\nmain: ${cmd.mainClass}\n`)

  const proc = spawn(javaExe, cmd.args, {
    cwd: join(paths.games(), project.dir),
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let firstOutput = true
  const write = (chunk: Buffer): void => {
    if (firstOutput) {
      firstOutput = false
      stage(5, '游戏进程已输出第一行')
    }
    const text = chunk.toString('utf8')
    const cleaned: string[] = []
    for (const raw of text.split(/\r?\n/)) {
      const line = cleanLogLine(raw)
      if (line) cleaned.push(line)
    }
    if (cleaned.length) appendFileSync(logFile, cleaned.join('\n') + '\n')
    for (const line of cleaned) onLine(line)
  }
  proc.stdout?.on('data', write)
  proc.stderr?.on('data', write)

  return { proc, logFile }
}

/** MC 的 log4j 控制台输出是 XML，转成可读文本 */
export function cleanLogLine(raw: string): string {
  const line = raw.trim()
  if (!line) return ''
  const m = /<log4j:Message><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Message>/.exec(line)
  if (m) return m[1].trim()
  if (line.startsWith('<') || line.startsWith('</')) return ''
  // 堆栈帧对普通用户没意义，界面上不显示（日志文件里也省掉，减少噪音）
  if (/^\s*at\s+[\w.$]+/.test(line) || line.startsWith('Caused by:') || line.startsWith('... ')) return ''
  return line
}

export function readTail(path: string, lines = 200): string {
  try {
    const content = readFileSync(path, 'utf-8')
    return content.split(/\r?\n/).slice(-lines).join('\n')
  } catch {
    return ''
  }
}

/**
 * Forge/NeoForge 的「早期窗口」(fmlearlywindow) 会在启动最初创建 OpenGL 4.6 上下文，
 * 部分显卡驱动组合会在这一步 EXCEPTION_ACCESS_VIOLATION 崩在 nvoglv64.dll。
 * 实测把实例 config/fml.toml 的 earlyWindowControl 关掉即可绕开（只是少个加载小窗）。
 */
function ensureForgeEarlyWindowOff(gameDir: string): void {
  try {
    const dir = join(gameDir, 'config')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'fml.toml')
    if (!existsSync(file)) {
      writeFileSync(file, '#RAINBOW MC：关闭 Forge 早期窗口，规避显卡驱动 OpenGL 崩溃\nearlyWindowControl = false\n', 'utf-8')
      return
    }
    const txt = readFileSync(file, 'utf-8')
    if (/^earlyWindowControl\s*=/m.test(txt)) {
      const next = txt.replace(/^earlyWindowControl\s*=.*$/m, 'earlyWindowControl = false')
      if (next !== txt) writeFileSync(file, next, 'utf-8')
      return
    }
    writeFileSync(file, `earlyWindowControl = false\n${txt}`, 'utf-8')
  } catch {
    /* 忽略：兼容处理不能影响启动 */
  }
}