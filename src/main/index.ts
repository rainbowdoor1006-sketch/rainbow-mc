import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, nativeTheme, screen, protocol } from 'electron'
import { join } from 'path'
import { ensureDirs, migrateLegacyData, paths, recoverBackupIfNeeded } from './paths'
import { state, updateSettings, persist, setActive } from './store'
import { registerMinecraftIpc, restoreRunningState } from './minecraft/ipc'
import { initAppearance, registerAppearanceIpc, registerAppearanceProtocol } from './appearance'
import { initProgress, snapshot } from './progress'
import type { AppSettings } from '@shared/types'

// 自定义协议要在 app ready 之前登记
protocol.registerSchemesAsPrivileged([
  { scheme: 'rainbow', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let mainWindow: BrowserWindow | null = null

// 单实例锁：重复启动时把已有窗口拉到前面，避免多个旧版本窗口互相干扰
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function createWindow(): void {
  const wa = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1240, Math.max(1000, wa.width - 80))
  const height = Math.min(800, Math.max(660, wa.height - 80))

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#0A0F1A',
    icon: join(__dirname, '../../build/icon.png'),
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 打包后关闭 devtools，防止随手打开控制台改状态
      devTools: !app.isPackaged
    }
  })

  // 明确取消置顶：否则系统文件对话框容易被压在启动器下面
  mainWindow.setAlwaysOnTop(false)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.center()
    mainWindow?.show()
  })

  // 打包后屏蔽 F12 / Ctrl+Shift+I / Ctrl+R
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!app.isPackaged) return
    const key = input.key.toLowerCase()
    const block =
      key === 'f12' ||
      (input.control && input.shift && (key === 'i' || key === 'j' || key === 'c')) ||
      (input.control && key === 'r')
    if (block) event.preventDefault()
  })

  // 禁止被外部链接导航走（钓鱼/替换页面）
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    shell.openExternal(url)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('app:getState', () => state())
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:paths', () => ({ root: paths.root(), logs: paths.logs(), games: paths.games() }))
  ipcMain.handle('settings:update', (_e, patch: Partial<AppSettings>) => updateSettings(patch))
  ipcMain.handle('app:setActive', (_e, patch: { activeAccountId?: string; activeProjectId?: string }) =>
    setActive(patch)
  )
  ipcMain.handle('app:persist', () => {
    persist()
    return true
  })

  ipcMain.handle('open:logs', async () => {
    ensureDirs()
    await shell.openPath(paths.logs())
    return true
  })
  ipcMain.handle('open:path', async (_e, p: string) => {
    await shell.openPath(p)
    return true
  })

  ipcMain.handle('win:minimize', () => mainWindow?.minimize())
  ipcMain.handle('win:toggleMaximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('win:close', () => mainWindow?.close())
  ipcMain.handle('win:isMaximized', () => mainWindow?.isMaximized() ?? false)
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'

  // ① 自愈：安装器在「备份 data → 还原」之间失败会留下 <安装目录>-data-backup，
  //    这里先把它恢复回来（存档、组件库、版本、加载器、资源全在 data/ 里）。
  const rec = recoverBackupIfNeeded()

  // ② 老用户（便携版 / 旧 %APPDATA% 数据）迁移到安装目录
  const mig = migrateLegacyData()

  ensureDirs()

  // ③ 迁移失败要把话说清楚，绝不能静默新建空目录让用户以为存档没了
  if (mig.failed) {
    setTimeout(() => {
      void dialog
        .showMessageBox({
          type: 'warning',
          title: '旧数据没有迁移成功',
          message: '检测到旧版本的数据还在原位置，但自动迁移失败了。',
          detail:
            `旧数据位置：\n${mig.legacyPath}\n\n` +
            '存档、组件库、游戏版本都还在那个目录里，没有被删除。\n' +
            '你可以手动把它里面的内容复制到现在的数据目录，或者点「打开旧目录」自己看一下。',
          buttons: ['打开旧目录', '知道了'],
          defaultId: 0,
          cancelId: 1
        })
        .then((r) => {
          if (r.response === 0) void shell.openPath(mig.legacyPath)
        })
    }, 1500)
  } else if (rec.recovered) {
    setTimeout(() => {
      void dialog.showMessageBox({
        type: 'info',
        title: '已恢复数据',
        message: '上次更新没有正常完成，已自动恢复你的数据。',
        detail: '存档、组件库、游戏版本、加载器都已恢复。',
        buttons: ['好的']
      })
    }, 1200)
  }
  state()
  registerIpc()
  initProgress(() => mainWindow)
  initAppearance(() => mainWindow)
  ipcMain.handle('dl:snapshot', () => snapshot())
  ipcMain.handle('app:copyText', (_e, text: string) => {
    try {
      clipboard.writeText(String(text || ''))
      return true
    } catch {
      return false
    }
  })
  registerAppearanceProtocol()
  registerAppearanceIpc()
  registerMinecraftIpc(() => mainWindow)
  restoreRunningState()

  // 无界面自测：RAINBOW_TEST_INSTALL=<版本号> 直接跑一遍安装后退出
  const testId = process.env['RAINBOW_TEST_INSTALL']
  if (testId) {
    void (async () => {
      const { installVersion } = await import('./minecraft/installer')
      let last = ''
      try {
        const r = await installVersion(testId, state().settings.downloadSource, (p) => {
          const line = `${p.stage} ${p.done}/${p.total}`
          if (line !== last && (p.stage !== 'assets' || p.done % 50 === 0)) {
            last = line
            console.log(line)
          }
        })
        console.log('RESULT', JSON.stringify(r))
      } catch (e) {
        console.log('FAIL', e instanceof Error ? e.message : String(e))
      }
      app.exit(0)
    })()
    return
  }

  // 无界面自测：RAINBOW_TEST_JAVA=<大版本号> 下载 JRE 后退出
  const testJava = process.env['RAINBOW_TEST_JAVA']
  if (testJava) {
    void (async () => {
      const { ensureJava } = await import('./minecraft/java')
      try {
        const r = await ensureJava(Number(testJava), (s, p) => console.log('java', s, p + '%'))
        console.log('JAVA', JSON.stringify(r))
      } catch (e) {
        console.log('JAVAFAIL', e instanceof Error ? e.message : String(e))
      }
      app.exit(0)
    })()
    return
  }

  // 无界面自测：RAINBOW_TEST_LAUNCH=<版本号> 直接启动一次游戏后退出
  const testLaunch = process.env['RAINBOW_TEST_LAUNCH']
  if (testLaunch) {
    void (async () => {
      const { launchGame } = await import('./minecraft/launcher')
      const { makeOfflineAccount } = await import('./minecraft/auth')
      const { newRunId, runLogPath, packLog } = await import('./minecraft/logs')
      const { join } = await import('path')
      const s = state()
      const project = {
        id: 'test',
        name: 'TEST',
        mcVersion: testLaunch,
        loader: 'vanilla' as const,
        createdAt: Date.now(),
        dir: 'test'
      }
      const account = makeOfflineAccount('Steve')
      const runId = newRunId()
      const logFile = runLogPath(runId)
      const t0 = Date.now()
      let ok = false
      try {
        const handle = await launchGame(project, account, s.settings, logFile, (line) => {          if (/Sound engine started|LWJGL Version|OpenAL initialized|Setting user/i.test(line)) {
            ok = true
          }
          if (process.env['RAINBOW_TEST_VERBOSE']) console.log('LOG', line)
        })
        const deadline = Date.now() + 90000
        while (Date.now() < deadline && !ok) await new Promise((r) => setTimeout(r, 500))
        await new Promise((r) => setTimeout(r, 3000))
        handle.proc.kill()
        console.log('LAUNCHOK', ok, 'ms', Date.now() - t0)
      } catch (e) {
        console.log('LAUNCHFAIL', e instanceof Error ? e.message : String(e))
      }
      const { readFileSync } = await import('fs')
      try {
        const tail = readFileSync(logFile, 'utf-8').split(/\r?\n/).slice(-15).join('\n')
        console.log('---TAIL---\n' + tail)
      } catch {
        /* ignore */
      }
      try {
        const zip = packLog(runId, {
          runId,
          startedAt: t0,
          projectId: 'test',
          projectName: 'TEST',
          version: testLaunch,
          loader: 'vanilla',
          account: 'Steve',
          loginMode: 'offline',
          exitCode: ok ? 0 : 1,
          errorCode: ok ? undefined : 'E2001',
          durationMs: Date.now() - t0
        }, logFile)
        console.log('ZIP', zip)
      } catch (e) {
        console.log('ZIPFAIL', e instanceof Error ? e.message : String(e))
      }
      app.exit(ok ? 0 : 1)
    })()
    return
  }

  // 无界面自测：RAINBOW_TEST_LOADER=fabric:1.20.1:<loaderVer>
  const testLoader = process.env['RAINBOW_TEST_LOADER']
  if (testLoader) {
    void (async () => {
      const [kind, base, ver] = testLoader.split(':')
      try {
        const mod = await import('./minecraft/loaders')
        const log = (m: string): void => console.log('STEP', m)
        let r: { versionId: string }
        if (kind === 'fabric') r = await mod.installFabric(base, ver, log)
        else if (kind === 'quilt') r = await mod.installQuilt(base, ver, log)
        else if (kind === 'forge') r = await mod.installForge(base, ver, log)
        else r = await mod.installNeoForge(base, ver, log)
        console.log('LOADEROK', JSON.stringify(r))
      } catch (e) {
        console.log('LOADERFAIL', e instanceof Error ? e.message : String(e))
      }
      app.exit(0)
    })()
    return
  }

  // 无界面自测：RAINBOW_TEST_SUPPORT=1.20.4 打印加载器支持矩阵
  const testSupport = process.env['RAINBOW_TEST_SUPPORT']
  if (testSupport) {
    void (async () => {
      try {
        const mod = await import('./minecraft/loaders')
        const s = await mod.loaderSupport(testSupport)
        console.log('SUPPORT', JSON.stringify(s))
        const list = await mod.listLoaders('forge', testSupport)
        console.log('FORGE_NEWEST', JSON.stringify(list.slice(0, 3)))
      } catch (e) {
        console.log('SUPPORTFAIL', e instanceof Error ? e.message : String(e))
      }
      app.exit(0)
    })()
    return
  }

  // 无界面自测：RAINBOW_TEST_MODRINTH=<mcVersion>:<loader>:<query>
  const testModrinth = process.env['RAINBOW_TEST_MODRINTH']
  if (testModrinth) {
    void (async () => {
      const [mcVersion, loader, query] = testModrinth.split(':')
      try {
        const mr = await import('./minecraft/modrinth')
        const res = await mr.searchProjects('mod', query || 'sodium', {
          loader: loader as never,
          mcVersion
        })
        console.log('HITS', res.total_hits, res.hits.slice(0, 3).map((h) => h.title).join(' | '))
        const hit = res.hits[0]
        const versions = await mr.listProjectVersions(hit.project_id, {
          loader: loader as never,
          mcVersion
        })
        console.log('VERSIONS', versions.length, versions[0]?.version_number)
        const out = await mr.installProjectVersion('modtest', 'mod', versions[0])
        console.log('INSTALLED', out.fileName)
      } catch (e) {
        console.log('MRFAIL', e instanceof Error ? e.message : String(e))
      }
      app.exit(0)
    })()
    return
  }

  // 无界面自测：RAINBOW_TEST_ZH="Sodium|Create|Iris Shaders"
  const testZh = process.env['RAINBOW_TEST_ZH']
  if (testZh) {
    void (async () => {
      try {
        const mod = await import('./minecraft/zhdict')
        const titles = testZh.split(/[|;]/).map((s) => s.trim()).filter(Boolean)
        const map = await mod.resolveZhBatch(titles.map((t) => ({ slug: '', title: t })))
        console.log('ZH', JSON.stringify(map))
        console.log('CACHE_SIZE', mod.zhCacheSize())
      } catch (e) {
        console.log('ZHFAIL', e instanceof Error ? e.message : String(e))
      }
      app.exit(0)
    })()
    return
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  // 退出前关掉联机服务，避免残留 terracotta 进程
  void import('./minecraft/multiplayer').then((mp) => mp.stop()).catch(() => undefined)
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
