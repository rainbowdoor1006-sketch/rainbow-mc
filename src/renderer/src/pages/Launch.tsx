import React from 'react'
import { useI18n } from '@/i18n'
import type { AppState } from '@shared/types'
import { IconFolder, IconPlay, IconStop } from '@/components/Icons'

export function Launch({
  state,
  launchingProjectId,
  runningProjectId,
  onLaunch,
  onKill
}: {
  state: AppState
  launchingProjectId: string | null
  runningProjectId: string | null
  onLaunch: () => void
  onKill: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const project = state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0]
  const activeAccount = state.accounts.find((a) => a.id === state.activeAccountId)
  const fmtTime = (ts?: number): string => (ts && ts > 1e11 ? new Date(ts).toLocaleString() : t('home.never'))

  if (!project) {
    return (
      <>
        <div className="page-head">
          <div className="page-title">{t('launch.title')}</div>
          <div className="page-desc">{t('launch.desc')}</div>
        </div>
        <div className="empty">
          <div style={{ fontSize: 15, color: 'var(--txt-dim)', marginBottom: 6 }}>{t('home.noProject')}</div>
          <div>{t('home.noProjectHint')}</div>
        </div>
      </>
    )
  }

  const isRunning = runningProjectId === project.id
  const isLaunching = launchingProjectId === project.id
  const canLaunch = !!activeAccount && !isRunning && !launchingProjectId

  return (
    <>
      <div className="page-head">
        <div className="page-title">{project.name}</div>
        <div className="page-desc">{t('launch.desc')}</div>
        {isRunning && <span className="tag ok">{t('launch.gameRunning')}</span>}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <div className="card" style={{ padding: 22 }}>
          <div className="card-title">{t('home.currentProject')}</div>
          <div className="row-between" style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 19, fontWeight: 620 }}>{project.name}</span>
              <span className="tag">{project.loader.toUpperCase()}</span>
            </div>
            <span className="dim mono">{project.versionId || project.mcVersion}</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {isRunning ? (
              <button className="btn danger" onClick={onKill}>
                <IconStop />
                {t('launch.forceStop')}
              </button>
            ) : isLaunching ? (
              <button className="btn danger" onClick={onKill}>
                <IconStop />
                {t('launch.cancelLaunch')}
              </button>
            ) : (
              <button className="btn primary" disabled={!canLaunch} onClick={onLaunch}>
                <IconPlay />
                {t('home.launch')}
              </button>
            )}
            <button className="btn" onClick={() => void window.api.project.openDir(project.id)}>
              <IconFolder />
              {t('home.openDir')}
            </button>
          </div>
          {!activeAccount && (
            <div className="dim" style={{ fontSize: 12, marginTop: 12 }}>
              {t('launch.needLogin')}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">{t('launch.status')}</div>
          <div className="dim" style={{ fontSize: 12.5, lineHeight: 2.1 }}>
            {t('home.lastPlayed')}：{fmtTime(project.lastPlayedAt)}
            <br />
            {t('home.mods')}：0 · {t('home.shaders')}：0
          </div>
        </div>
      </div>
    </>
  )
}
