import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execSync } from 'child_process'
import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { AccountInfo, AppSettings, GameProject } from '@shared/types'
import type { InstallProgress, VersionSummary } from '@shared/mclib'
import { getManifest, getVersionJson, installVersion, listInstalledVersions } from './installer'
import { ensureJava, findInstalledJava } from './java'
import { makeLocalAccount, makeOfflineAccount, isValidOfflineName } from './auth'
import { installFabric, installForge, installNeoForge, installQuilt, listLoaders, loaderSupport } from './loaders'
import { ensureAssets, ensureVersionFiles } from './installer'
import { downloadCfFiles } from './cf'
import * as mp from './multiplayer'
import {
  getProjectInfo,
  getVersion,
  installProjectVersion,
  listProjectVersions,
  projectTitles,
  searchProjects,
  type ProjectKind
} from './modrinth'
import { checkProject, readManifest, removeEntry, upsertEntry } from './mods'
import { resolveZhBatch, zhCacheSize } from './zhdict'
import { backupSave, deleteMod, deleteSave, exportInstance, exportStartScript, importPack, instanceDir, listModFiles, listSaves, screenshotDir, toggleMod } from './instance'
import { autoMemoryMb, buildCommand, totalMemoryMb } from './launcher'
import { addLoaderEntry, applyToProject, downloadToLibrary, initLibrary, listLibrary, projectLibraryState, removeFromLibrary, usageProjects } from './library'
import { startTask, updateTask, finishTask } from '../progress'
import { launchGame } from './launcher'
import { listLogs, newRunId, packLog, runLogPath } from './logs'
import { paths } from '../paths'
import {
  checkForUpdate,
  downloadInstaller,
  localVersion,
  localVersionCode,
  restartAfterUpdate,
  runInstaller,
  type LatestInfo
} from '../update'
import { setAccounts, setActive, state, setProjects, persist, updateSettings } from '../store'

function source(): AppSettings['downloadSource'] {
  return state().settings.downloadSource
}

const running = new Map<string, { kill: () => void; pid?: number; projectId: string }>()
const userKilled = new Set<string>()
/** 正在准备（还没 spawn 出 java 进程）的启动，用于「取消启动」 */
let pendingLaunch: { runId: string; projectId: string; cancelled: boolean; abort?: () => void } | null = null

function runStateFile(): string {
  return join(paths.logs(), 'runstate.json')
}

function saveRunState(): void {
  try {
    const data = [...running.entries()].map(([runId, v]) => ({ runId, projectId: v.projectId, pid: v.pid }))
    require('fs').writeFileSync(runStateFile(), JSON.stringify(data, null, 2), 'utf-8')
  } catch {
    /* 记录失败不影响启动 */
  }
}

function pidAlive(pid?: number): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 启动器重启后把还在跑的游戏接回来，否则「结束游戏」按钮会丢 */
export function restoreRunningState(): void {
  try {
    const fs = require('fs') as typeof import('fs')
    if (!fs.existsSync(runStateFile())) return
    const list = JSON.parse(fs.readFileSync(runStateFile(), 'utf-8')) as {
      runId: string
      projectId: string
      pid?: number
    }[]
    for (const item of list) {
      if (!pidAlive(item.pid)) continue
      running.set(item.runId, {
        pid: item.pid,
        projectId: item.projectId,
        kill: () => killProcessTree(item.pid)
      })
    }
    saveRunState()
  } catch {
    /* 忽略损坏的状态文件 */
  }
}

function killProcessTree(pid?: number, fallback?: () => void): void {
  if (!pid) {
    fallback?.()
    return
  }
  try {
    const { spawn } = require('child_process') as typeof import('child_process')
    const p = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    p.on('error', () => fallback?.())
  } catch {
    fallback?.()
  }
}

function folderOfKind(kind: string): string {
  if (kind === 'mod') return 'mods'
  if (kind === 'shader') return 'shaderpacks'
  if (kind === 'resourcepack') return 'resourcepacks'
  if (kind === 'loader') return 'loaders'
  return 'modpacks'
}
function nameTaken(name: string, exceptId?: string): boolean {
  const n = name.trim().toLowerCase()
  return state().projects.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === n)
}

function uniqueName(base: string, exceptId?: string): string {
  const clean = (base || '未命名项目').trim().slice(0, 36)
  if (!nameTaken(clean, exceptId)) return clean
  for (let i = 2; i < 200; i++) {
    const cand = `${clean} ${i}`
    if (!nameTaken(cand, exceptId)) return cand
  }
  return `${clean} ${Date.now().toString().slice(-4)}`
}


/** 列出显示适配器名称（用于识别虚拟显示器导致的 OpenGL 崩溃） */
function listGpus(): string[] {
  try {
    const out = require('child_process').execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"',
      { encoding: 'utf8', timeout: 6000, windowsHide: true }
    ) as string
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}


/**
 * 显卡类崩溃时自动做的兼容处理（尽量不让用户去点驱动设置）：
 * ① 把 javaw.exe 在高性能 GPU 偏好里登记（用户级注册表，不需要管理员）
 * ② 把渲染类模组（Embeddium/Sodium/Rubidium/Oculus/Iris）移到 mods.disabled，下次启动用原版渲染
 */
function applyGpuCompatFix(projectDir: string, signature: string, logFile: string): string[] {
  const done: string[] = []
  const instDir = join(paths.games(), projectDir)

  if (/NVIDIA|Intel|显卡|OpenGL/i.test(signature)) {
    try {
      const java = findRuntimeJava()
      if (java) {
        const key = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
        execSync(
          `reg add "${key}" /v "${java}" /t REG_SZ /d "GpuPreference=2;" /f`,
          { stdio: 'ignore', windowsHide: true, timeout: 5000 }
        )
        done.push('已把 javaw.exe 登记为「高性能 GPU」')
      }
    } catch {
      /* 忽略 */
    }
  }

  if (/NVIDIA|OpenGL/i.test(signature)) {
    const modsDir = join(instDir, 'mods')
    const disabledDir = join(instDir, 'mods.disabled')
    try {
      mkdirSync(disabledDir, { recursive: true })
      const targets = readdirSync(modsDir).filter((f: string) =>
        /^(embeddium|sodium|rubidium|oculus|iris|sodium-extra|embeddium-extra).*\.jar$/i.test(f)
      )
      for (const f of targets) {
        renameSync(join(modsDir, f), join(disabledDir, f))
      }
      if (targets.length) done.push(`已临时禁用渲染优化模组：${targets.join('、')}（在 mods.disabled 里）`)
    } catch {
      /* 忽略 */
    }
  }

  if (done.length) {
    try {
      appendFileSync(logFile, '\n=== 自动兼容处理 ===\n' + done.map((d) => '· ' + d).join('\n') + '\n')
    } catch {
      /* 忽略 */
    }
  }
  return done
}

/** 找到启动器使用的 javaw.exe（优先自带 runtime） */
function findRuntimeJava(): string | null {
  try {
    const base = paths.runtime()
    if (!base || !existsSync(base)) return null
    const stack: string[] = [base]
    while (stack.length) {
      const dir = stack.pop() as string
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) stack.push(full)
        else if (e.name.toLowerCase() === 'javaw.exe') return full
      }
    }
  } catch {
    /* 忽略 */
  }
  return null
}
/** 从运行日志里提取「最后到达的阶段」，并给出崩溃分类 */
function analyzeRunLog(logFile: string): { lastStage: string; signature: string; advice: string } {
  let txt = ''
  try {
    txt = readFileSync(logFile, 'utf-8')
  } catch {
    return { lastStage: '未知', signature: '无法读取日志', advice: '' }
  }
  const stageLines = txt.split(/\r?\n/).filter((l) => l.includes('▶ 阶段'))
  const lastStage = stageLines.length ? stageLines[stageLines.length - 1].replace(/^.*▶ 阶段/, '阶段').trim() : '启动器阶段日志缺失'

  const sigs: { re: RegExp; signature: string; advice: string }[] = [
    {
      re: /nvoglv64\.dll/i,
      signature: 'NVIDIA OpenGL 驱动 (nvoglv64.dll)',
      advice: 'Forge 早期窗口已自动关闭；若仍在游戏窗口初始化时崩溃，属于驱动层问题，可在版本设置里换用其他渲染模组或更新驱动'
    },
    { re: /ig[0-9]+icd|igdumd|igxelpicd/i, signature: 'Intel 核显驱动', advice: '尝试把该程序指定为使用独立显卡' },
    { re: /OutOfMemoryError/i, signature: '内存不足 (OOM)', advice: '在版本设置里把内存调大' },
    { re: /java\.lang\.ClassNotFoundException|NoClassDefFoundError/i, signature: '缺少类 / 库文件不完整', advice: '删除该版本后重新安装，或点「补齐库文件」' },
    { re: /Missing or unsupported mandatory dependencies|ModResolutionException|missing dependencies/i, signature: '模组依赖缺失', advice: '在模组页点「一键下载前置组件」' },
    { re: /mixin.*(apply|inject).*(failed|error)|Mixin apply failed/i, signature: 'Mixin 注入失败（模组不兼容）', advice: '多为模组版本不匹配，参考该模组页面要求' },
    { re: /Exception in thread "main"|A fatal error has been detected/i, signature: 'Java 层致命错误', advice: '查看日志里的 hs_err 文件' }
  ]
  for (const s of sigs) {
    if (s.re.test(txt)) return { lastStage, signature: s.signature, advice: s.advice }
  }
  return { lastStage, signature: '未识别', advice: '' }
}
/** 根据日志尾部内容给崩溃加一句人话提示（显卡驱动类崩溃很常见） */
function diagnoseCrash(logFile: string): string | undefined {
  try {
    const txt = readFileSync(logFile, 'utf-8')
    const tail = txt.slice(-20000)
    if (/nvoglv64\.dll|nvwgf2umx\.dll|EXCEPTION_ACCESS_VIOLATION.*nv/i.test(tail)) {
      const gpus = listGpus()
      const virtual = gpus.filter((g) => /gameviewer|sunlogin|parsec|virtual|remote|basic render/i.test(g))
      return (
        '显卡驱动（NVIDIA OpenGL）在创建游戏窗口时崩溃。' +
        (gpus.length ? `当前显卡：${gpus.join(' / ')}。` : '') +
        (virtual.length
          ? `检测到虚拟显示器：${virtual.join('、')}，请先退出向日葵/远程桌面或禁用它的虚拟显示器再试。`
          : '请更新 NVIDIA 驱动，或在 Windows 图形设置里把这个程序指定为「高性能 GPU」。')
      )
    }
    if (/Fatal error|A fatal error has been detected by the Java Runtime Environment/i.test(tail)) {
      return 'Java 虚拟机发生致命错误，详情见日志里的 hs_err 文件。'
    }
    if (/java\.lang\.OutOfMemoryError/i.test(tail)) {
      return '内存不足：把「版本设置 → 内存」调大，或减少同时加载的模组。'
    }
    if (/ModLauncher running/i.test(tail)) {
      return '游戏在加载阶段退出，具体原因见日志最后 30 行。'
    }
  } catch {
    /* 读不到日志就算了 */
  }
  return undefined
}
export function registerMinecraftIpc(getWindow: () => BrowserWindow | null): void {
  // 组件库需要知道当前有哪些项目，才能算「这个组件被哪些项目用了」
  initLibrary(() => state().projects)
  const emit = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload)
  }

  // 恢复来的进程没有 exit 回调，靠轮询发现它已经退出
  setInterval(() => {
    let changed = false
    for (const [runId, v] of running) {
      if (v.pid && !pidAlive(v.pid)) {
        running.delete(runId)
        changed = true
        emit('mc:running', { running: false, runId, projectId: v.projectId })
      }
    }
    if (changed) saveRunState()
  }, 4000).unref?.()

  ipcMain.handle('mc:manifest', async (_e, force?: boolean) => {
    const m = await getManifest(source(), !!force)
    return { latest: m.latest, versions: m.versions as VersionSummary[] }
  })

  ipcMain.handle('mc:installed', () => listInstalledVersions())

  ipcMain.handle('mc:install', async (_e, id: string) => {
    const taskId = 'ver:' + id
    startTask(taskId, `Minecraft ${id}`, 'version', 100)
    try {
      const result = await installVersion(id, source(), (p: InstallProgress) => {
        emit('mc:install-progress', p)
        // 把安装阶段折算成一条总进度，给右下角圆圈用
        const stagePct: Record<string, number> = {
          prepare: 3,
          client: 10,
          libraries: 30,
          assetIndex: 40,
          assets: 60,
          legacy: 85,
          log4j: 92,
          done: 100
        }
        const base = stagePct[p.stage] ?? 20
        const span = (p.stage === 'libraries' ? 40 : p.stage === 'assets' ? 35 : 6) as number
        const frac = p.total > 0 ? p.done / p.total : 0
        updateTask(taskId, { pct: Math.min(99, base + span * frac), label: `Minecraft ${id}${p.message ? ' · ' + p.message : ''}` })
      })
      finishTask(taskId, `Minecraft ${id}`)
      return result
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      emit('mc:install-progress', {
        versionId: id,
        stage: 'error',
        done: 0,
        total: 1,
        bytes: 0,
        message
      })
      return { ok: false, errors: [message] }
    }
  })

  ipcMain.handle('mc:javaCheck', (_e, major: number) => findInstalledJava(major))
  ipcMain.handle('mc:javaEnsure', async (_e, major: number) => {
    const taskId = 'java:' + major
    startTask(taskId, 'Java ' + major + ' 运行时', 'java', 100)
    try {
      const r = await ensureJava(major, (stage, pct) => updateTask(taskId, { pct }))
      finishTask(taskId)
      return r
    } catch (e) {
      finishTask(taskId)
      throw e
    }
  })


  /* ---------- 联机（Terracotta） ---------- */
  ipcMain.handle('mp:status', () => mp.currentStatus())
  ipcMain.handle('mp:binary', () => mp.binaryInfo())
  ipcMain.handle('mp:install', async () => {
    return mp.ensureTerracotta((message) => emit('mp:progress', { message }))
  })
  ipcMain.handle('mp:host', async (_e, player: string) => {
    const r = await mp.host(player)
    emit('mp:state', mp.currentStatus())
    return r
  })
  ipcMain.handle('mp:join', async (_e, payload: { code: string; player: string }) => {
    const r = await mp.joinRoom(payload.code, payload.player)
    emit('mp:state', mp.currentStatus())
    return r
  })
  ipcMain.handle('mp:idle', async () => {
    await mp.idle()
    return mp.currentStatus()
  })
  ipcMain.handle('mp:stop', async () => {
    await mp.stop()
    return mp.currentStatus()
  })
  mp.onStatus((s) => emit('mp:state', s))
  /* ---------- 账号 ---------- */
  ipcMain.handle('account:list', () => state().accounts)


  // 纯离线登录：不连接任何服务器，直接创建本地账号
  ipcMain.handle('account:localLogin', async (_e, payload: { name: string }) => {
    const name = (payload?.name || '').trim()
    if (!isValidOfflineName(name)) {
      return { ok: false, errorCode: 'E9002', message: '昵称只能是 3-16 位字母、数字或下划线' }
    }
    const s = state()
    const account = makeLocalAccount(name)
    const accounts = [...s.accounts.filter((a) => a.id !== account.id), account]
    setAccounts(accounts)
    setActive({ activeAccountId: account.id })
    persist()
    return { ok: true, account }
  })




  /* ---------- 加载器 ---------- */
  ipcMain.handle('loader:list', async (_e, payload: { loader: string; mcVersion: string }) => {
    try {
      const [list, support] = await Promise.all([
        listLoaders(payload.loader as never, payload.mcVersion),
        loaderSupport(payload.mcVersion)
      ])
      return { ok: true, list, support }
    } catch (e) {
      return { ok: false, errorCode: 'E3001', message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'loader:install',
    async (
      _e,
      payload: {
        loader: 'fabric' | 'forge' | 'neoforge' | 'quilt'
        mcVersion: string
        loaderVersion: string
        projectName?: string
      }
    ) => {
      const progress = (msg: string): void => emit('loader:progress', { message: msg })
      try {
        progress('准备中')
        let result: { versionId: string }
        if (payload.loader === 'fabric') {
          result = await installFabric(payload.mcVersion, payload.loaderVersion, progress)
        } else if (payload.loader === 'quilt') {
          result = await installQuilt(payload.mcVersion, payload.loaderVersion, progress)
        } else if (payload.loader === 'forge') {
          result = await installForge(payload.mcVersion, payload.loaderVersion, progress)
        } else {
          result = await installNeoForge(payload.mcVersion, payload.loaderVersion, progress)
        }

        // 装完直接建一个项目
        const s = state()
        const id = randomUUID()
        const project: GameProject = {
          id,
          name: (payload.projectName || `${payload.mcVersion} ${payload.loader}`).slice(0, 40),
          mcVersion: payload.mcVersion,
          versionId: result.versionId,
          loader: payload.loader,
          loaderVersion: payload.loaderVersion,
          createdAt: Date.now(),
          dir: id
        }
        mkdirSync(join(paths.games(), project.dir), { recursive: true })
        // 加载器也进组件库，方便以后给别的项目复用
        addLoaderEntry({
          type: payload.loader,
          version: payload.loaderVersion,
          mcVersion: payload.mcVersion
        })
        setProjects([...s.projects, project])
        setActive({ activeProjectId: project.id })
        persist()
        progress('完成')
        return { ok: true, project, versionId: result.versionId }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        return { ok: false, errorCode: 'E3002', message }
      }
    }
  )

  ipcMain.handle('account:setActive', (_e, id: string) => {    setActive({ activeAccountId: id })
    persist()
    return state()
  })

  ipcMain.handle('account:remove', (_e, id: string) => {
    const s = state()
    setAccounts(s.accounts.filter((a) => a.id !== id))
    if (s.activeAccountId === id) setActive({ activeAccountId: undefined })
    persist()
    return state()
  })

  /* ---------- 项目 ---------- */
  ipcMain.handle('project:list', () => state().projects)

  ipcMain.handle('project:create', (_e, payload: { name: string; mcVersion: string; loader?: GameProject['loader'] }) => {
    const s = state()
    const id = randomUUID()
    const project: GameProject = {
      id,
      name: uniqueName(payload.name || payload.mcVersion),
      mcVersion: payload.mcVersion,
      loader: payload.loader ?? 'vanilla',
      createdAt: Date.now(),
      dir: id
    }
    mkdirSync(join(paths.games(), project.dir), { recursive: true })
    setProjects([...s.projects, project])
    setActive({ activeProjectId: project.id })
    persist()
    return { ok: true, project }
  })

  ipcMain.handle('project:rename', (_e, payload: { id: string; name: string }) => {
    const s = state()
    const safe = uniqueName(payload.name, payload.id)
    setProjects(s.projects.map((p) => (p.id === payload.id ? { ...p, name: safe } : p)))
    persist()
    return state()
  })

  ipcMain.handle('project:remove', (_e, id: string) => {
    const s = state()
    const project = s.projects.find((p) => p.id === id)
    setProjects(s.projects.filter((p) => p.id !== id))
    if (s.activeProjectId === id) setActive({ activeProjectId: undefined })
    if (project) {
      try {
        rmSync(join(paths.games(), project.dir), { recursive: true, force: true })
      } catch {
        /* 目录被占用就保留 */
      }
    }
    persist()
    return state()
  })

  ipcMain.handle('project:setActive', (_e, id: string) => {
    setActive({ activeProjectId: id })
    persist()
    return state()
  })

  ipcMain.handle('project:openDir', async (_e, id: string) => {
    const project = state().projects.find((p) => p.id === id)
    if (!project) return false
    await shell.openPath(join(paths.games(), project.dir))
    return true
  })

  /* ---------- 启动 ---------- */
  ipcMain.handle('mc:launch', async (_e, projectId: string) => {
    const s = state()
    const project = s.projects.find((p) => p.id === projectId)
    const account = s.accounts.find((a) => a.id === s.activeAccountId)
    const runId = newRunId()

    if (!project) return { ok: false, errorCode: 'E1002', message: '项目不存在' }
    if (!account) return { ok: false, errorCode: 'E9001', message: '未登录账号' }

    const logFile = runLogPath(runId)
    const startedAt = Date.now()
    let abortReject: ((e: Error) => void) | null = null
    const abortPromise = new Promise<never>((_, reject) => {
      abortReject = reject
    })
    pendingLaunch = {
      runId,
      projectId: project.id,
      cancelled: false,
      abort: () => abortReject?.(new Error('已取消启动'))
    }
    emit('mc:running', { running: false, runId, projectId: project.id, starting: true })

    try {
      // 启动前补齐缺失的游戏库：
      // 库是 data\libraries 全局共享的，不同版本会要求不同版本号的同一个库
      // （1.20.1 要 log4j 2.19.0，26.3 要 2.26.0）。只装过其中一个版本时，
      // 另一个版本启动会直接 java.lang.module.FindException 崩掉。
      emit('mc:launch-line', { runId, line: '[启动器] 正在检查游戏库…' })
      try {
        const fixed = await ensureVersionFiles(
          project.versionId || project.mcVersion,
          s.settings.downloadSource,
          (msg) => emit('mc:launch-line', { runId, line: `[启动器] ${msg}` })
        )
        if (fixed.downloaded > 0) {
          emit('mc:launch-line', { runId, line: `[启动器] 已补齐 ${fixed.downloaded} 个库文件` })
        }        // 资源文件（语言/声音/字体）：缺了会出现「语言列表空白」这类问题
        try {
          const assets = await ensureAssets(
            project.versionId || project.mcVersion,
            s.settings.downloadSource,
            (msg) => emit('mc:launch-line', { runId, line: `[启动器] ${msg}` })
          )
          if (assets.downloaded > 0) {
            emit('mc:launch-line', { runId, line: `[启动器] 已补齐 ${assets.downloaded} 个资源文件` })
          }
        } catch {
          /* 资源补齐失败不阻塞启动 */
        }
        if (fixed.failed > 0) {
          emit('mc:launch-line', { runId, line: `[启动器] 有 ${fixed.failed} 个库文件下载失败` })
        }
      } catch {
        /* 补齐失败就让后面的启动流程去报具体错误 */
      }

      // 准备阶段最多等 180 秒（下载 Java / 解压 natives 卡住时能自己退出来）
      const launchPromise = launchGame(
        project,
        account,
        s.settings,
        logFile,
        (line) => emit('mc:launch-line', { runId, line }),
        () => !!pendingLaunch?.cancelled
      )
      // 竞速失败时（取消/超时）launchGame 仍在后台跑，吞掉它的异常，避免 unhandled rejection
      launchPromise.catch(() => undefined)

      const handle = await Promise.race([
        launchPromise,
        abortPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('启动准备超时（Java 下载/文件解压可能卡住了）')), 180000)
        )
      ])
      const wasCancelled = pendingLaunch?.cancelled
      pendingLaunch = null
      if (wasCancelled) {
        try {
          killProcessTree(handle.proc.pid, () => handle.proc.kill())
        } catch {
          /* ignore */
        }
      }
      running.set(runId, { kill: () => handle.proc.kill(), pid: handle.proc.pid, projectId: project.id })
      saveRunState()
      emit('mc:launch-started', { runId, logFile })
      emit('mc:running', { running: true, runId, projectId: project.id })

      const exitCode: number = await new Promise((resolve) => {
        handle.proc.on('exit', (code) => resolve(code ?? -1))
        handle.proc.on('error', () => resolve(-1))
      })
      running.delete(runId)
      saveRunState()
      const killed = userKilled.has(runId)
      userKilled.delete(runId)
      emit('mc:running', { running: false, runId, projectId: project.id })

      // 崩溃时先把「停在哪一步 + 什么类型的错」写进日志，再打包
      let diag = { lastStage: '', signature: '', advice: '' }
      if (!killed && exitCode !== 0) {
        diag = analyzeRunLog(logFile)
        applyGpuCompatFix(project.dir, diag.signature, logFile)
        const lines = [
          '',
          '=== 启动诊断 ===',
          `退出码: ${exitCode > 2147483647 ? exitCode - 4294967296 : exitCode}（异常）`,
          `耗时: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
          `最后阶段: ${diag.lastStage}`,
          `崩溃特征: ${diag.signature}`,
          diag.advice ? `建议: ${diag.advice}` : '',
          ''
        ].filter((l) => l !== '')
        try {
          appendFileSync(logFile, lines.join('\n') + '\n')
        } catch {
          /* 忽略 */
        }
      }

      const zip = packLog(runId, {
        runId,
        startedAt,
        projectId: project.id,
        projectName: project.name,
        version: project.mcVersion,
        loader: project.loader,
        account: account.name,
        loginMode: account.mode,
        exitCode,
        // Windows 上被强杀的进程会给 4294967295（无符号的 -1），归一化成可读值
        exitCodeSigned: exitCode > 2147483647 ? exitCode - 4294967296 : exitCode,
        stopReason: killed ? 'user' : exitCode === 0 ? 'exit' : 'crash',
        errorCode: killed || exitCode === 0 ? undefined : 'E2001',
        message: killed ? '用户从启动器结束游戏' : undefined,
        durationMs: Date.now() - startedAt
      }, logFile)

      setProjects(
        s.projects.map((p) => (p.id === project.id ? { ...p, lastPlayedAt: Date.now() } : p))
      )
      persist()

      const result = {
        ok: exitCode === 0 || killed,
        killed,
        code: exitCode,
        errorCode: killed || exitCode === 0 ? undefined : 'E2001',
        logFile,
        zip,
        runId
      }
      emit('mc:launch-done', result)
      return result
    } catch (e) {
      const cancelled = pendingLaunch?.cancelled
      pendingLaunch = null
      userKilled.delete(runId)
      const message = cancelled
        ? '已取消启动'
        : e instanceof Error
          ? e.message
          : String(e)
      const errorCode = cancelled ? 'E2098' : /java/i.test(message) ? 'E1001' : /超时/.test(message) ? 'E2003' : 'E1003'
      const zip = packLog(runId, {
        runId,
        startedAt,
        projectId: project.id,
        projectName: project.name,
        version: project.mcVersion,
        loader: project.loader,
        account: account.name,
        loginMode: account.mode,
        errorCode: cancelled ? undefined : errorCode,
        message,
        durationMs: Date.now() - startedAt
      }, logFile)
      const result = { ok: cancelled, killed: cancelled, errorCode: cancelled ? undefined : errorCode, message, logFile, zip, runId }
      emit('mc:running', { running: false, runId, projectId: project.id })
      emit('mc:launch-done', result)
      return result
    }
  })

  ipcMain.handle('logs:list', () => listLogs())

  ipcMain.handle('mc:running', () => [...running.entries()].map(([runId, v]) => ({ runId, projectId: v.projectId })))

  ipcMain.handle('mc:kill', (_e, runId?: string) => {
    const targets = runId ? ([[runId, running.get(runId)]] as const) : [...running.entries()]
    for (const [id, entry] of targets) {
      if (!entry) continue
      userKilled.add(id)
      killProcessTree(entry.pid, entry.kill)
    }
    // 还没 spawn 出进程的启动：打上取消标记，并立刻中断等待中的启动流程
    if (pendingLaunch) {
      if (!runId || runId === pendingLaunch.runId) {
        pendingLaunch.cancelled = true
        userKilled.add(pendingLaunch.runId)
        emit('mc:launch-line', { runId: pendingLaunch.runId, line: '[启动器] 已请求取消启动…' })
        try {
          pendingLaunch.abort?.()
        } catch {
          /* ignore */
        }
      }
    }
    return true
  })

  /** 下载加载器到组件库（不安装、不建项目） */
  ipcMain.handle(
    'loader:download',
    async (_e, payload: { loader: 'fabric' | 'forge' | 'neoforge' | 'quilt'; mcVersion: string; loaderVersion: string }) => {
      try {
        addLoaderEntry({
          type: payload.loader,
          version: payload.loaderVersion,
          mcVersion: payload.mcVersion
        })
        return { ok: true }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  /** 把组件库里的加载器应用到某个项目（这一步才真正安装） */
  ipcMain.handle('library:applyLoader', async (_e, payload: { id: string; projectId: string }) => {
    const entry = listLibrary().find((e) => e.id === payload.id)
    const project = state().projects.find((p) => p.id === payload.projectId)
    if (!entry || !entry.loader || !project) return { ok: false, message: '组件或项目不存在' }
    const { type, version, mcVersion } = entry.loader
    const progress = (msg: string): void => emit('loader:progress', { message: msg })
    try {
      progress('准备中')
      let result: { versionId: string }
      if (type === 'fabric') result = await installFabric(mcVersion, version, progress)
      else if (type === 'quilt') result = await installQuilt(mcVersion, version, progress)
      else if (type === 'forge') result = await installForge(mcVersion, version, progress)
      else result = await installNeoForge(mcVersion, version, progress)

      const s = state()
      setProjects(
        s.projects.map((p) =>
          p.id === project.id
            ? { ...p, versionId: result.versionId, loader: type as never, loaderVersion: version }
            : p
        )
      )
      persist()
      return { ok: true, versionId: result.versionId }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('project:nameTaken', (_e, name: string) => nameTaken(name))
  ipcMain.handle('project:uniqueName', (_e, name: string) => uniqueName(name))

  /** 拖拽 ZIP / 整合包文件进来：解压分析后单独建项目 */
  let packCancel = false
  let packAbort: AbortController | null = null
  ipcMain.handle('pack:cancel', () => {
    packCancel = true
    try {
      packAbort?.abort()
    } catch {
      /* ignore */
    }
    return true
  })

  ipcMain.handle('pack:importPath', async (_e, payload: { path: string; name?: string }) => {
    const { importPack } = await import('./instance')
    packCancel = false
    packAbort = new AbortController()
    const ctrl = packAbort
    try {
      let usedName = ''
      const result = await importPack(payload.path, (p) => {
        const s = state()
        const id = randomUUID()
        usedName = uniqueName(payload.name || p.name)
        const project: GameProject = {
          id,
          name: usedName,
          mcVersion: p.mcVersion,
          loader: (p.loader as GameProject['loader']) ?? 'vanilla',
          loaderVersion: p.loaderVersion,
          createdAt: Date.now(),
          dir: id
        }
        mkdirSync(join(paths.games(), project.dir), { recursive: true })
        if (p.loader && p.loader !== 'vanilla') {
          addLoaderEntry({ type: p.loader, version: p.loaderVersion || '', mcVersion: p.mcVersion })
        }
        setProjects([...s.projects, project])
        setActive({ activeProjectId: project.id })
        persist()
        return project
      },
        (prog) => emit('pack:progress', { ...prog, name: usedName || payload.name || '' }),
        () => packCancel,
        ctrl.signal
      )

      // ── 关键修复：导进来的项目必须真的装好加载器，否则启动就是原版 ──
      const info = result as { projectId?: string; loader?: string; mcVersion?: string }
      if (result.ok && info.projectId && info.loader && info.loader !== 'vanilla' && info.mcVersion) {
        const proj = state().projects.find((x) => x.id === info.projectId)
        if (proj && proj.loaderVersion) {
          emit('pack:progress', { stage: 'loader', done: 0, total: 1, name: `安装 ${proj.loader} ${proj.loaderVersion}` })
          const progress = (m: string): void =>
            emit('pack:progress', { stage: 'loader', done: 0, total: 1, name: m })
          try {
            let lr: { versionId: string }
            const abort = (): boolean => packCancel || ctrl.signal.aborted
            if (proj.loader === 'fabric') lr = await installFabric(info.mcVersion, proj.loaderVersion, progress)
            else if (proj.loader === 'quilt') lr = await installQuilt(info.mcVersion, proj.loaderVersion, progress)
            else if (proj.loader === 'forge')
              lr = await installForge(info.mcVersion, proj.loaderVersion, progress, abort)
            else lr = await installNeoForge(info.mcVersion, proj.loaderVersion, progress, abort)

            const s3 = state()
            setProjects(s3.projects.map((x) => (x.id === info.projectId ? { ...x, versionId: lr.versionId } : x)))
            persist()

            // CurseForge 包：模组不在包里，必须按 ID 解析下载
            const cfFiles = (result as { cfFiles?: { projectId: number; fileId: number }[] }).cfFiles
            if (cfFiles?.length) {
              progress(`下载 CurseForge 模组（${cfFiles.length} 个）…`)
              const cf = await downloadCfFiles(
                state().settings,
                proj.dir,
                cfFiles,
                progress,
                ctrl.signal
              )
              if (cf.downloaded) progress(`已下载 ${cf.downloaded} 个 CurseForge 模组`)
              if (cf.message) progress(cf.message)
            }

            // 导入完成后顺带补齐这一版需要的全部库（原版 + 加载器），
            // 否则首次启动可能缺 log4j 之类的共享库，直接 FindException 崩溃
            try {
              progress('补齐游戏库…')
              const fixed = await ensureVersionFiles(lr.versionId, state().settings.downloadSource, progress)
              if (fixed.downloaded > 0) progress(`已补齐 ${fixed.downloaded} 个库文件`)
            } catch {
              /* 补齐失败不阻塞导入 */
            }
          } catch {
            /* 加载器装失败也不回滚项目，用户可以在组件库里手动应用 */
          }
        }
      }

      // 被取消：把刚建的项目和目录一起清掉
      if (packCancel || ctrl.signal.aborted || !result.ok) {
        const s2 = state()
        const created = usedName ? s2.projects.find((x) => x.name === usedName) : undefined
        if (created) {
          try {
            rmSync(join(paths.games(), created.dir), { recursive: true, force: true })
          } catch {
            /* ignore */
          }
          setProjects(s2.projects.filter((x) => x.id !== created.id))
          persist()
        }
        if (!result.ok) return { ok: false, message: result.message || '导入失败' }
        return { ok: false, message: '已取消导入' }
      }
      return { ok: true, name: usedName, result }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })
  /** 保存自定义头像（1:1 PNG），持久化到 avatars 目录，重启后仍生效 */
  ipcMain.handle('avatar:save', (_e, payload: { accountId: string; dataUrl: string }) => {
    const m = /^data:image\/\w+;base64,(.+)$/i.exec(payload.dataUrl || '')
    if (!m) return { ok: false, message: '图片数据无效' }
    try {
      const dir = join(paths.root(), 'avatars')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, payload.accountId.replace(/[^\w.-]/g, '_') + '.png')
      writeFileSync(file, Buffer.from(m[1], 'base64'))
      const s = state()
      setAccounts(s.accounts.map((a) => (a.id === payload.accountId ? { ...a, avatar: file, avatarVer: Date.now() } : a)))
      persist()
      return { ok: true, file }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 还原成首字母头像 */
  ipcMain.handle('avatar:reset', (_e, accountId: string) => {
    const s = state()
    setAccounts(s.accounts.map((a) => (a.id === accountId ? { ...a, avatar: undefined, avatarVer: Date.now() } : a)))
    persist()
    return { ok: true }
  })
  /* ---------- 组件库 ---------- */
  ipcMain.handle('library:list', () => listLibrary())
  ipcMain.handle('library:remove', (_e, id: string) => removeFromLibrary(id))
  ipcMain.handle('library:usage', (_e, id: string) => {
    const e = listLibrary().find((x) => x.id === id)
    return e ? usageProjects(e) : []
  })
  ipcMain.handle('library:apply', (_e, payload: { ids: string[]; projectId: string }) =>
    applyToProject(payload.ids, payload.projectId)
  )
  ipcMain.handle('library:usageDetail', (_e, id: string) => {
    const entry = listLibrary().find((x) => x.id === id)
    if (!entry) return []
    return state().projects.map((p) => {
      const rel = folderOfKind(String(entry.kind))
      const abs = join(paths.games(), p.dir, rel, entry.fileName)
      return { id: p.id, name: p.name, has: existsSync(abs) }
    })
  })

  ipcMain.handle('library:removeFromProject', (_e, payload: { id: string; projectId: string }) => {
    const entry = listLibrary().find((x) => x.id === payload.id)
    const project = state().projects.find((p) => p.id === payload.projectId)
    if (!entry || !project) return { ok: false }
    const rel = entry.kind === 'mod' ? 'mods' : entry.kind === 'shader' ? 'shaderpacks' : 'resourcepacks'
    const abs = join(paths.games(), project.dir, rel, entry.fileName)
    try {
      if (existsSync(abs)) unlinkSync(abs)
      if (entry.kind === 'mod') removeEntry(project.dir, entry.fileName)
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('library:projectState', (_e, projectId: string) => projectLibraryState(projectId))
  ipcMain.handle('library:download', async (_e, payload: { projectId: string; title: string; kind: ProjectKind; versionId: string; iconUrl?: string; slug?: string }) => {
    try {
      const v = await getVersion(payload.versionId)
      const r = await downloadToLibrary(payload.title, payload.kind, payload.projectId, v, payload.iconUrl, payload.slug)
      return r
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })
  /* ---------- 组件主页 / 依赖 ---------- */
  ipcMain.handle('modrinth:projectInfo', async (_e, id: string) => {
    try {
      const info = await getProjectInfo(id)
      return { ok: true, info }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 某个版本的依赖分析：缺哪些前置、需要什么加载器 */
  ipcMain.handle(
    'modrinth:depInfo',
    async (
      _e,
      payload: { versionId: string; projectId: string; targetProjectId?: string }
    ) => {
      try {
        const version = await getVersion(payload.versionId)
        const req = version.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id)
        const ids = req.map((d) => d.project_id as string)
        const titles = ids.length ? await projectTitles(ids) : {}

        const project = state().projects.find((p) => p.id === payload.targetProjectId)
        const installed = new Set<string>()
        if (project) {
          for (const m of readManifest(project.dir)) installed.add(m.projectId)
        }
        // 组件库里的也算「已安装」：没有项目时下载都会进组件库，
        // 如果只看项目目录，就会出现「库里明明有、这里还显示缺失」的错误状态。
        for (const e of listLibrary()) {
          if (e.projectId) installed.add(e.projectId)
        }

        const deps = req.map((d) => ({
          projectId: d.project_id as string,
          title: titles[d.project_id as string] || (d.project_id as string),
          installed: installed.has(d.project_id as string)
        }))

        return {
          ok: true,
          version: {
            id: version.id,
            name: version.name,
            versionNumber: version.version_number,
            gameVersions: version.game_versions,
            loaders: version.loaders
          },
          deps,
          neededLoader: version.loaders.find((l) => l !== 'vanilla') || null,
          mcVersions: version.game_versions
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  /** 一键下载前置组件（下载到组件库，已在库里的跳过） */
  ipcMain.handle(
    'modrinth:installDeps',
    async (_e, payload: { versionId: string; targetProjectId?: string }) => {
      try {
        const version = await getVersion(payload.versionId)
        const required = version.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id)
        const depTitles = await projectTitles(required.map((d) => d.project_id as string))
        const lib = listLibrary()
        const libProjectIds = new Set(lib.map((e) => e.projectId))

        const depMc = version.game_versions[0]
        const depLoader = version.loaders.find((l) => l !== 'vanilla') as never

        const installed: string[] = []
        const skipped: string[] = []
        const failed: string[] = []

        for (const dep of required) {
          const pid = dep.project_id as string
          const title = depTitles[pid] || pid
          if (libProjectIds.has(pid)) {
            skipped.push(title)
            continue
          }
          let list = await listProjectVersions(pid, { loader: depLoader, mcVersion: depMc })
          if (!list.length) list = await listProjectVersions(pid, { mcVersion: depMc })
          if (!list.length) list = await listProjectVersions(pid, { loader: depLoader })
          const pick = list[0]
          if (!pick) {
            failed.push(title)
            continue
          }
          const r = await downloadToLibrary(title, 'mod', pid, pick)
          if (!r.ok) {
            failed.push(title)
            continue
          }
          libProjectIds.add(pid)
          installed.push(title)
        }
        return { ok: true, installed, skipped, failed }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    }
  )
  /* ---------- Modrinth 资源 ---------- */
  ipcMain.handle(
    'modrinth:search',
    async (
      _e,
      payload: {
        kind: ProjectKind
        query: string
        loader?: string
        mcVersion?: string
        offset?: number
        limit?: number
        index?: 'relevance' | 'downloads' | 'newest' | 'updated'
      }
    ) => {
      try {
        const r = await searchProjects(payload.kind, payload.query, {
          loader: payload.loader as never,
          mcVersion: payload.mcVersion,
          offset: payload.offset ?? 0,
          limit: payload.limit ?? 30,
          index: payload.index
        })
        return { ok: true, ...r }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'modrinth:versions',
    async (_e, payload: { projectId: string; loader?: string; mcVersion?: string }) => {
      try {
        const list = await listProjectVersions(payload.projectId, {
          loader: payload.loader as never,
          mcVersion: payload.mcVersion
        })
        return { ok: true, list }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'modrinth:install',
    async (
      _e,
      payload: { projectId: string; title: string; kind: ProjectKind; versionId: string; targetProjectId: string }
    ) => {
      const s = state()
      const project = s.projects.find((p) => p.id === payload.targetProjectId)
      if (!project) return { ok: false, message: '目标项目不存在' }
      try {
        const versions = await listProjectVersions(payload.projectId, {
          loader: project.loader,
          mcVersion: project.mcVersion
        })
        const version = versions.find((v) => v.id === payload.versionId) ?? versions[0]
        if (!version) return { ok: false, message: '没有适配该项目的版本' }

        const { fileName } = await installProjectVersion(project.dir, payload.kind, version)

        const depIds = version.dependencies
          .filter((d) => d.dependency_type === 'required' && d.project_id)
          .map((d) => d.project_id as string)
        let titles: Record<string, string> = {}
        try {
          titles = await projectTitles(depIds)
        } catch {
          /* 拿不到标题不影响安装 */
        }

        upsertEntry(project.dir, {
          projectId: payload.projectId,
          title: payload.title,
          versionId: version.id,
          versionNumber: version.version_number,
          fileName,
          kind: payload.kind,
          gameVersions: version.game_versions,
          loaders: version.loaders,
          dependencies: version.dependencies.map((d) => ({
            projectId: d.project_id,
            type: d.dependency_type,
            title: d.project_id ? titles[d.project_id] : undefined
          })),
          installedAt: Date.now()
        })

        const issues = checkProject(project)
        return { ok: true, fileName, issues }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  /* ---------- 实例：设置 / 模组 / 存档 ---------- */
  const findProject = (id: string): GameProject | undefined => state().projects.find((p) => p.id === id)

  ipcMain.handle('projects:stats', () => {
    const s = state()
    return s.projects.map((p) => {
      let modCount = 0
      let saveCount = 0
      try {
        modCount = listModFiles(p).length
        saveCount = listSaves(p).length
      } catch {
        /* 目录还不存在 */
      }
      return {
        id: p.id,
        modCount,
        saveCount,
        lastPlayedAt: p.lastPlayedAt ?? 0,
        createdAt: p.createdAt
      }
    })
  })

  ipcMain.handle('instance:info', (_e, projectId: string) => {    const project = findProject(projectId)
    if (!project) return { ok: false, message: '项目不存在' }
    return {
      ok: true,
      project,
      dir: instanceDir(project),
      mods: listModFiles(project),
      saves: listSaves(project),
      issues: checkProject(project),
      installed: readManifest(project.dir)
    }
  })

  ipcMain.handle(
    'instance:update',
    (_e, payload: { id: string; patch: Partial<GameProject> }) => {
      const s = state()
      const list = s.projects.map((p) => (p.id === payload.id ? { ...p, ...payload.patch } : p))
      setProjects(list)
      persist()
      return state()
    }
  )

  ipcMain.handle('instance:memInfo', () => ({ totalMb: totalMemoryMb(), autoMb: Math.round(autoMemoryMb()) }))

  ipcMain.handle('instance:openScreenshotsDir', async (_e, projectId: string) => {
    const project = findProject(projectId)
    if (!project) return false
    const { mkdirSync } = require('fs') as typeof import('fs')
    const dir = screenshotDir(project)
    mkdirSync(dir, { recursive: true })
    const shellMod = require('electron').shell as typeof import('electron').shell
    await shellMod.openPath(dir)
    return true
  })

  ipcMain.handle('instance:exportScript', async (_e, projectId: string) => {
    const project = findProject(projectId)
    if (!project) return { ok: false, message: '项目不存在' }
    try {
      const s = state()
      const json = await getVersionJson(project.versionId || project.mcVersion, s.settings.downloadSource)
      const major = json.javaVersion?.majorVersion ?? 8
      const javaExe = project.javaPath || s.settings.javaPath || findInstalledJava(major) || 'javaw.exe'
      const account = s.accounts.find((a) => a.id === s.activeAccountId)
      if (!account) return { ok: false, message: '请先登录账号' }
      const cmd = await buildCommand(project, account, s.settings, javaExe)
      const p = exportStartScript(project, javaExe, cmd.args)
      return { ok: true, path: p }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('instance:repair', async (_e, projectId: string) => {
    const project = findProject(projectId)
    if (!project) return { ok: false, message: '项目不存在' }
    try {
      const r = await installVersion(project.versionId || project.mcVersion, state().settings.downloadSource, (p) =>
        emit('mc:install-progress', p)
      )
      return r
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  /* ---------- 启动器文件夹（PCL 的文件夹列表） ---------- */
  /* ---------- 更新检查（对接 rainbowdoor.icu，任何失败都不阻塞启动） ---------- */
  ipcMain.handle('update:check', async () => {
    const r = await checkForUpdate(state().settings.updateChannel)
    return r
  })

  ipcMain.handle('update:local', () => ({ version: localVersion(), code: localVersionCode() }))

  ipcMain.handle('update:skip', async (_e, version: string) => {
    updateSettings({ skippedVersion: version })
    return true
  })

  ipcMain.handle('update:download', async (_e, latest: LatestInfo) => {
    return downloadInstaller(latest, (loaded, total) => emit('update:progress', { loaded, total }))
  })

  ipcMain.handle('update:apply', async (_e, installerPath: string) => {
    const r = runInstaller(installerPath)
    // 安装器会主动结束本进程；装完后由安装脚本重新拉起新版本
    if (r.ok) setTimeout(() => app.exit(0), 1500)
    return r
  })

  ipcMain.handle('update:open', async (_e, url: string) => {
    const shellMod = require('electron').shell as typeof import('electron').shell
    await shellMod.openExternal(url)
    return true
  })

  ipcMain.handle('launcher:folders', () => {    const s = state()
    const list = [{ path: join(paths.root(), 'games'), label: 'RAINBOW MC 实例目录' }]
    for (const d of s.settings.gameDirs) list.push({ path: d, label: d })
    return list
  })

  ipcMain.handle('launcher:addFolder', async () => {
    const { dialog } = require('electron') as typeof import('electron')
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { ok: false }
    const dir = r.filePaths[0]
    const s = state()
    if (!s.settings.gameDirs.includes(dir)) updateSettings({ gameDirs: [...s.settings.gameDirs, dir] })
    return { ok: true, path: dir }
  })

  /* ---------- 整合包导入 ---------- */
  ipcMain.handle('launcher:importPack', async () => {
    const { dialog } = require('electron') as typeof import('electron')
    const r = await dialog.showOpenDialog({
      filters: [
        { name: '整合包', extensions: ['mrpack', 'zip'] },
        { name: '全部文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, message: '已取消' }
    try {
      const result = await importPack(r.filePaths[0], (p) => {
        const s = state()
        const id = randomUUID()
        const project: GameProject = {
          id,
          name: uniqueName(p.name),
          mcVersion: p.mcVersion,
          loader: (p.loader as GameProject['loader']) ?? 'vanilla',
          loaderVersion: p.loaderVersion,
          createdAt: Date.now(),
          dir: id
        }
        mkdirSync(join(paths.games(), project.dir), { recursive: true })
        if (p.loader && p.loader !== 'vanilla') {
          addLoaderEntry({ type: p.loader, version: p.loaderVersion || '', mcVersion: p.mcVersion })
        }
        setProjects([...s.projects, project])
        setActive({ activeProjectId: project.id })
        persist()
        return project
      })
      return result
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  /* ---------- Mod：从文件安装 / 批量启停 ---------- */
  ipcMain.handle('mods:fromFile', async (_e, projectId: string) => {
    const project = findProject(projectId)
    if (!project) return { ok: false, message: '项目不存在' }
    const { dialog } = require('electron') as typeof import('electron')
    const r = await dialog.showOpenDialog({
      filters: [{ name: 'Mod', extensions: ['jar'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (r.canceled || !r.filePaths.length) return { ok: false, message: '已取消' }
    const { copyFileSync, mkdirSync: mk } = require('fs') as typeof import('fs')
    const { basename, join: pj } = require('path') as typeof import('path')
    const dest = pj(instanceDir(project), 'mods')
    mk(dest, { recursive: true })
    for (const f of r.filePaths) copyFileSync(f, pj(dest, basename(f)))
    return { ok: true, count: r.filePaths.length, mods: listModFiles(project) }
  })

  ipcMain.handle('mods:bulk', (_e, payload: { projectId: string; enable: boolean }) => {
    const project = findProject(payload.projectId)
    if (!project) return { ok: false, mods: [] }
    for (const m of listModFiles(project)) {
      if (m.enabled !== payload.enable) toggleMod(project, m.fileName)
    }
    return { ok: true, mods: listModFiles(project) }
  })

  ipcMain.handle('instance:toggleMod', (_e, payload: { projectId: string; fileName: string }) => {
    const project = findProject(payload.projectId)
    if (!project) return { ok: false, mods: [] }
    return { ok: true, mods: toggleMod(project, payload.fileName) }
  })

  ipcMain.handle('instance:deleteMod', (_e, payload: { projectId: string; fileName: string }) => {
    const project = findProject(payload.projectId)
    if (!project) return { ok: false, mods: [] }
    return { ok: true, mods: deleteMod(project, payload.fileName) }
  })

  ipcMain.handle('instance:backupSave', (_e, payload: { projectId: string; saveName: string }) => {
    const project = findProject(payload.projectId)
    if (!project) return { ok: false, message: '项目不存在' }
    return backupSave(project, payload.saveName)
  })

  ipcMain.handle('instance:deleteSave', (_e, payload: { projectId: string; saveName: string }) => {
    const project = findProject(payload.projectId)
    if (!project) return { ok: true, saves: [] }
    return { ok: true, saves: deleteSave(project, payload.saveName) }
  })

  ipcMain.handle('instance:openDir', async (_e, projectId: string) => {
    const project = findProject(projectId)
    if (!project) return false
    const shellMod = require('electron').shell as typeof import('electron').shell
    await shellMod.openPath(instanceDir(project))
    return true
  })

  ipcMain.handle('instance:openModsDir', async (_e, projectId: string) => {
    const project = findProject(projectId)
    if (!project) return false
    const { mkdirSync } = require('fs') as typeof import('fs')
    const { join: pjoin } = require('path') as typeof import('path')
    const dir = pjoin(instanceDir(project), 'mods')
    mkdirSync(dir, { recursive: true })
    const shellMod = require('electron').shell as typeof import('electron').shell
    await shellMod.openPath(dir)
    return true
  })

  ipcMain.handle('instance:openSavesDir', async (_e, projectId: string) => {
    const project = findProject(projectId)
    if (!project) return false
    const { mkdirSync } = require('fs') as typeof import('fs')
    const { join: pjoin } = require('path') as typeof import('path')
    const dir = pjoin(instanceDir(project), 'saves')
    mkdirSync(dir, { recursive: true })
    const shellMod = require('electron').shell as typeof import('electron').shell
    await shellMod.openPath(dir)
    return true
  })

  ipcMain.handle('instance:export', (_e, projectId: string) => {
    const project = findProject(projectId)
    if (!project) return { ok: false, message: '项目不存在' }
    return exportInstance(project)
  })

  ipcMain.handle('zh:batch', async (_e, items: { slug: string; title: string }[]) => {    try {
      const map = await resolveZhBatch(items || [])
      return { ok: true, map, cached: zhCacheSize() }
    } catch (e) {
      return { ok: false, map: {}, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('mods:list', (_e, projectId: string) => {    const project = state().projects.find((p) => p.id === projectId)
    if (!project) return { entries: [], issues: [] }
    return { entries: readManifest(project.dir), issues: checkProject(project) }
  })

  ipcMain.handle('mods:remove', (_e, payload: { projectId: string; fileName: string }) => {
    const project = state().projects.find((p) => p.id === payload.projectId)
    if (!project) return { entries: [], issues: [] }
    removeEntry(project.dir, payload.fileName)
    return { entries: readManifest(project.dir), issues: checkProject(project) }
  })
}
