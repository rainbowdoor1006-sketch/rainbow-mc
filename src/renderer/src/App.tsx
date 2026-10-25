import React, { useCallback, useEffect, useRef, useState } from 'react'
import { I18nProvider, localeForRegion, useI18n } from '@/i18n'
import type { AppSettings, AppState, LocaleCode, RegionCode } from '@shared/types'
import { MainlandNotice, RegionPicker } from '@/components/RegionGate'
import { AccountsDialog, LaunchError, LaunchOverlay, LocalLogin } from '@/components/Dialogs'
import { PreLaunchDialog } from '@/components/PreLaunchDialog'
import { ConsolePanel } from '@/components/ConsolePanel'
import { InstancePanel } from '@/components/InstancePanel'
import { ProjectList } from '@/components/ProjectList'
import { LoginGate } from '@/components/LoginGate'
import { AppearanceLayer } from '@/components/AppearanceLayer'
import { DownloadOrb } from '@/components/DownloadOrb'
import { DropImport } from '@/components/DropImport'
import { LibraryPage } from '@/pages/LibraryPage'
import { Multiplayer } from '@/pages/Multiplayer'
import { UpdateDialog, type LatestInfoView, type UpdateMode } from '@/components/UpdateDialog'
import { TopBar } from '@/components/TopBar'
import { SidePanel } from '@/components/SidePanel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Launch } from '@/pages/Launch'
import { Download } from '@/pages/Download'
import { Settings } from '@/pages/Settings'
import { More } from '@/pages/More'

export type Page = 'launch' | 'download' | 'library' | 'multiplayer' | 'settings' | 'more'
type Dialog = 'none' | 'project' | 'login-local' | 'accounts' | 'instance'

export default function App(): React.ReactElement {
  const [state, setState] = useState<AppState | null>(null)
  const [page, setPage] = useState<Page>('launch')
  const [gate, setGate] = useState<'none' | 'picker' | 'notice'>('none')
  const [dialog, setDialog] = useState<Dialog>('none')
  const [preProject, setPreProject] = useState<{ id: string; name: string } | null>(null)
  const [showConsole, setShowConsole] = useState(false)
  const [launchingProjectId, setLaunchingProjectId] = useState<string | null>(null)
  const [running, setRunning] = useState<{ runId: string; projectId: string } | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  const [error, setError] = useState<{
    code: string
    message?: string
    diagnosis?: {
      code: string
      category: string
      title: string
      confidence: 'high' | 'medium' | 'low'
      evidence: string[]
      steps: string[]
      facts: string[]
    } | null
  } | null>(null)
  const [updateMode, setUpdateMode] = useState<UpdateMode | null>(null)
  const [updateLatest, setUpdateLatest] = useState<LatestInfoView | null>(null)
  const [updateLocal, setUpdateLocal] = useState('')
  const [updateProgress, setUpdateProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [updateError, setUpdateError] = useState('')
  const [currentVersion, setCurrentVersion] = useState('—')
  const linesRef = useRef<string[]>([])

  // Ctrl+K 打开主控台
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowConsole((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ESC 关闭当前弹出层（错误弹窗 / 更新弹窗 / 各种对话框 / 日志浮层）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (error) {
        setError(null)
        return
      }
      if (updateMode) {
        setUpdateMode(null)
        return
      }
      if (dialog !== 'none') {
        setDialog('none')
        return
      }
      if (showLog) setShowLog(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [error, updateMode, dialog, showLog])

  const refresh = useCallback(() => {
    window.api.getState().then(setState)
  }, [])

  useEffect(() => {
    window.api.getState().then((s) => {
      setState(s)
      if (!s.settings.regionChosen) {
        const needNotice = s.settings.region === 'CN' && !s.settings.regionNoticeAccepted
        setGate(needNotice ? 'notice' : 'picker')
      }
    })
    if (window.api.uiFlags?.testErrorDialog) {
      setError({
        code: 'E2100',
        message: '游戏进程异常退出（测试弹窗）',
        diagnosis: {
          code: 'E2100',
          category: 'env',
          title: '内存不足 —— 分配 2 GB，这个整合包至少需要 17 GB',
          confidence: 'high',
          evidence: [
            'java.lang.OutOfMemoryError: Java heap space',
            'at cpw.mods.niofs.union.UnionFileSystem.byteChannel(UnionFileSystem.java:348)'
          ],
          steps: [
            '进入「版本设置 → 内存」，把内存调到 17 GB（最多不超过物理内存的 60%）',
            '同时关闭浏览器、直播、网盘同步等占内存的程序',
            '改完直接重新启动，不需要重装整合包'
          ],
          facts: ['模组数量：564 个', '当前分配：2 GB', '该体量建议：16 GB 以上']
        }
      })
    }
    void window.api.getVersion().then(setCurrentVersion)
    void window.api.getState().then(async (s) => {
      if (!s.settings.autoCheckUpdate) return
      const r = await window.api.update.check()
      if (!r.ok || !r.latest) return
      if (r.state === 'older') {
        // 用户点过「不用了，谢谢」的同一个版本，不再打扰
        if (s.settings.skippedVersion === r.latest.version) return
        // 显示「实际参与比较的本地版本」，否则会出现 0.2.1 → 0.2.1 这种错觉
        setUpdateLocal(r.local.version)
        setUpdateLatest(r.latest)
        setUpdateMode('newer')
      } else if (r.state === 'newer') {
        setUpdateLocal(r.local.version)
        setUpdateLatest(r.latest)
        setUpdateMode('preview')
      }
    })
    const offLine = window.api.mc.onLaunchLine(({ line }) => {
      linesRef.current = [...linesRef.current, line]
      setLines(linesRef.current)
    })
    const offDone = window.api.mc.onLaunchDone((r) => {
      setLaunchingProjectId(null)
      if (!r.ok && !r.killed) setError({ code: r.errorCode || 'E0000', message: r.message })
      refresh()
    })
    const offRunning = window.api.mc.onRunning((p) => {
      setRunning(p.running ? { runId: p.runId, projectId: p.projectId } : null)
    })
    void window.api.mc.running().then((list) => {
      if (list.length) setRunning(list[0])
    })
    return () => {
      offLine()
      offDone()
      offRunning()
    }
  }, [refresh])

  const applySettings = useCallback(async (patch: Partial<AppSettings>) => {
    const s = await window.api.updateSettings(patch)
    setState(s)
  }, [])

  const setLocale = useCallback(
    (l: LocaleCode) => {
      void applySettings({ locale: l })
    },
    [applySettings]
  )

  const pickRegion = useCallback(async (r: RegionCode) => {
    const s = await window.api.updateSettings({
      region: r,
      locale: localeForRegion(r),
      regionChosen: r !== 'CN',
      regionNoticeAccepted: r !== 'CN'
    })
    setState(s)
    setGate(r === 'CN' ? 'notice' : 'none')
  }, [])

  const ackNotice = useCallback(async () => {
    const s = await window.api.updateSettings({ regionChosen: true, regionNoticeAccepted: true })
    setState(s)
    setGate('none')
  }, [])

  const cancelNotice = useCallback(async () => {
    const s = await window.api.updateSettings({ regionChosen: false, regionNoticeAccepted: false })
    setState(s)
    setGate('picker')
  }, [])

  /** 真正发起启动（预估弹窗确认后调用） */
  const startProject = useCallback(
    async (projectId: string) => {
      linesRef.current = []
      setLines([])
      setLaunchingProjectId(projectId)
      setError(null)
      setShowLog(true)
      await window.api.mc.launch(projectId)
    },
    []
  )

  const doLaunch = useCallback(async () => {
    if (!state) return
    const project = state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0]
    if (!project) return
    // 大整合包先做资源预估，避免 4GB 内存硬跑 500 模组直接 OOM
    if (project.loader && project.loader !== 'vanilla') {
      setPreProject(project)
      return
    }
    await startProject(project.id)
  }, [state, startProject])

  const doKill = useCallback(async () => {
    // 不传 runId：准备阶段也能取消，运行中则杀进程树
    await window.api.mc.kill(running?.runId)
  }, [running])

  if (!state) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="dim">...</div>
      </div>
    )
  }

  return (
    <I18nProvider locale={state.settings.locale} setLocale={setLocale}>
      <AppearanceLayer appearance={state.settings.appearance} />
      <DownloadOrb />
      <DropImport onImported={() => void refresh()} />
      {!(() => {
        const active = state.accounts.find((a) => a.id === state.activeAccountId)
        if (!active) return false
        // 离线账号：不需要任何令牌
        return active.mode === 'offline'
      })() && (
        <LoginGate onLocalLogin={() => setDialog('login-local')} />
      )}
      <AppShell
        state={state}
        page={page}
        setPage={setPage}
        launchingProjectId={launchingProjectId}
        runningProjectId={running?.projectId ?? null}
        onKill={() => void doKill()}
        onPickRegion={pickRegion}
        applySettings={applySettings}
        onLaunch={() => void doLaunch()}
        onPickProject={() => setDialog('project')}
        onOpenInstance={() => setDialog('instance')}
        onOpenAccounts={() => setDialog('accounts')}
        onLogin={() => {
          const saved = state.accounts.find((a) => a.mode === 'offline')
          if (saved) {
            void window.api.account.setActive(saved.id).then(() => refresh())
            return
          }
          setDialog('login-local')
        }}
        onRefresh={refresh}
      />

      {dialog === 'project' && (
        <ProjectList
          state={state}
          onClose={() => setDialog('none')}
          onChanged={refresh}
          onOpenInstance={(id) => {
            void window.api.project.setActive(id).then(() => {
              refresh()
              setDialog('instance')
            })
          }}
        />
      )}
      {showConsole && <ConsolePanel onClose={() => setShowConsole(false)} />}
      {preProject && (
        <PreLaunchDialog
          projectId={preProject.id}
          projectName={preProject.name}
          onCancel={() => setPreProject(null)}
          onOpenSettings={() => {
            setPreProject(null)
            setDialog('instance')
          }}
          onContinue={() => {
            const id = preProject.id
            setPreProject(null)
            void startProject(id)
          }}
        />
      )}
      {dialog === 'accounts' && (
        <AccountsDialog
          accounts={state.accounts.map((a) => ({ id: a.id, name: a.name, mode: a.mode, uuid: a.uuid }))}
          activeId={state.activeAccountId}
          onSwitch={(id) => {
            void window.api.account.setActive(id).then(() => {
              setDialog('none')
              refresh()
            })
          }}
          onRemove={(id) => {
            void window.api.account.remove(id).then(() => refresh())
          }}
          onClose={() => setDialog('none')}
        />
      )}

      {dialog === 'login-local' && (
        <LocalLogin
          onClose={() => setDialog('none')}
          onDone={() => {
            setDialog('none')
            refresh()
          }}
        />
      )}

      {dialog === 'instance' && state && state.projects.length > 0 && (
        <InstancePanel
          state={state}
          project={state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0]}
          onClose={() => setDialog('none')}
          onChanged={refresh}
          onGoDownload={() => {
            setDialog('none')
            setPage('download')
          }}
          onGoSettings={() => {
            setDialog('none')
            setPage('settings')
          }}
          onDeleted={() => setDialog('none')}
        />
      )}

      {showLog && !!launchingProjectId && (
        <LaunchOverlay
          lines={lines}
          onClose={() => setShowLog(false)}
          onKill={() => {
            void window.api.mc.kill()
          }}
        />
      )}

      {error && (
        <LaunchError
          errorCode={error.code}
          message={error.message}
          diagnosis={error.diagnosis}
          onClose={() => setError(null)}
          onOpenLogs={() => {
            void window.api.openLogs()
          }}
        />
      )}

      {updateMode && (
        <UpdateDialog
          mode={updateMode}
          localVersion={updateLocal || currentVersion}
          latest={updateLatest ?? undefined}
          progress={updateProgress}
          error={updateError}
          onUpdate={() => {
            if (!updateLatest) return
            void (async () => {
              setUpdateError('')
              setUpdateProgress({ loaded: 0, total: updateLatest.size })
              const off = window.api.update.onProgress((p) => setUpdateProgress(p))
              const r = await window.api.update.download(updateLatest)
              off()
              setUpdateProgress(null)
              if (!r.ok || !r.path) {
                setUpdateError(r.message || '下载失败')
                return
              }
              const applied = await window.api.update.apply(r.path)
              if (!applied.ok) setUpdateError(applied.message || '安装失败')
            })()
          }}
          onSkip={() => {
            if (updateLatest) void window.api.update.skip(updateLatest.version)
            setUpdateMode(null)
          }}
          onContinue={() => setUpdateMode(null)}
          onQuit={() => void window.api.win.close()}
        />
      )}

      {gate === 'picker' && <RegionPicker onPick={pickRegion} />}
      {gate === 'notice' && <MainlandNotice onAck={ackNotice} onCancel={cancelNotice} />}
    </I18nProvider>
  )
}

function AppShell({
  state,
  page,
  setPage,
  launchingProjectId,
  runningProjectId,
  onKill,
  onPickRegion,
  applySettings,
  onLaunch,
  onPickProject,
  onOpenInstance,
  onLogin,
  onOpenAccounts,
  onRefresh
}: {
  state: AppState
  page: Page
  setPage: (p: Page) => void
  launchingProjectId: string | null
  runningProjectId: string | null
  onKill: () => void
  onPickRegion: (r: RegionCode) => void
  applySettings: (patch: Partial<AppSettings>) => Promise<void>
  onLaunch: () => void
  onPickProject: () => void
  onOpenInstance: () => void
  onLogin: (m: 'local') => void
  onOpenAccounts: () => void
  onRefresh: () => void
}): React.ReactElement {
  const { t } = useI18n()

  return (
    <div className="app">
      <TopBar page={page} setPage={setPage} />
      <div className="body">
        <SidePanel
          state={state}
          launchingProjectId={launchingProjectId}
          runningProjectId={runningProjectId}
          onKill={onKill}
          onGoDownload={() => setPage('download')}
          onLaunch={onLaunch}
          onPickProject={onPickProject}
          onOpenInstance={onOpenInstance}
          onLogin={onLogin}
        onOpenAccounts={onOpenAccounts}
          onRefresh={onRefresh}
        />
        <div className="content">
          <div className="content-watermark">{t('app.name')}</div>
          <div className="content-scroll">
            <ErrorBoundary resetKey={page} onReset={() => setPage('launch')}>
              {page === 'launch' && (
                <Launch
                  state={state}
                  launchingProjectId={launchingProjectId}
                  runningProjectId={runningProjectId}
                  onLaunch={onLaunch}
                  onKill={onKill}
                />
              )}
              {page === 'download' && <Download state={state} />}
              {page === 'library' && <LibraryPage />}
              {page === 'multiplayer' && (
                <Multiplayer playerName={state.accounts.find((a) => a.id === state.activeAccountId)?.name || 'Player'} />
              )}
              {page === 'settings' && (
                <Settings settings={state.settings} onChange={applySettings} onPickRegion={onPickRegion} onRefresh={onRefresh} />
              )}
              {page === 'more' && <More state={state} applySettings={applySettings} />}
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  )
}
