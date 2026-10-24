import React, { useState } from 'react'
import { useI18n } from '@/i18n'
import type { AppState } from '@shared/types'
import { IconPlay, IconStop } from './Icons'
import { AvatarCrop } from './AvatarCrop'

export function SidePanel({
  state,
  launchingProjectId,
  runningProjectId,
  onKill,
  onGoDownload,
  onLaunch,
  onPickProject,
  onOpenInstance,
  onLogin,
  onOpenAccounts,
  onRefresh
}: {
  state: AppState
  launchingProjectId: string | null
  runningProjectId: string | null
  onKill: () => void
  onGoDownload: () => void
  onLaunch: () => void
  onPickProject: () => void
  onOpenInstance: () => void
  onLogin: (mode: 'local') => void
  onOpenAccounts: () => void
  onRefresh?: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [appVersion, setAppVersion] = React.useState('')
  React.useEffect(() => {
    void window.api.getVersion().then(setAppVersion).catch(() => undefined)
  }, [])
  const activeAccount = state.accounts.find((a) => a.id === state.activeAccountId)
  const project = state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0]
  const mode = activeAccount?.mode ?? 'microsoft'
  const isRunning = !!project && runningProjectId === project.id
  const isLaunching = !!project && launchingProjectId === project.id
  const someLaunching = !!launchingProjectId
  const canLaunch = !!activeAccount && !!project && !someLaunching && !runningProjectId
  const [cropData, setCropData] = useState('')

  const pickAvatar = async (): Promise<void> => {
    if (!activeAccount) return
    const r = await window.api.avatar.pick()
    if (!r.ok || !r.dataUrl) return
    setCropData(r.dataUrl)
  }

  const saveAvatar = async (dataUrl: string): Promise<void> => {
    if (!activeAccount) return
    await window.api.avatar.save(activeAccount.id, dataUrl)
    setCropData('')
    onRefresh?.()
  }

  const avatarSrc = activeAccount?.avatar
    ? /^https?:/i.test(activeAccount.avatar)
      ? activeAccount.avatar
      : 'rainbow://local/' + encodeURIComponent(activeAccount.avatar) + '?v=' + (activeAccount.avatarVer || 0)
    : ''

  return (
    <div className="side">
      <div className="seg">
        <button className={'seg-btn' + (mode === 'offline' ? ' active' : '')} onClick={() => onLogin('local')}>
          {t('accounts.local')}
        </button>
      </div>

      <div className="avatar-wrap">
        <div
          className="avatar"
          title={activeAccount ? t('avatar.change') : undefined}
          onClick={() => void pickAvatar()}
          style={{ cursor: activeAccount ? 'pointer' : 'default', overflow: 'hidden' }}
        >
          {avatarSrc ? (
            <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            (activeAccount?.name ?? '?').slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="avatar-name" onClick={onOpenAccounts} style={{ cursor: 'pointer' }} title={t('accounts.switch')}>{activeAccount?.name ?? t('accounts.notLoggedIn')}</div>
        <div className="avatar-sub">
          {activeAccount ? (
            <span className="mono">{activeAccount.uuid.slice(0, 8)}</span>
          ) : (
            <span onClick={() => onLogin('local')} style={{ cursor: 'pointer' }}>
              {t('accounts.loginHint')}
            </span>
          )}
        </div>
      </div>

      <div className="side-spacer" />

      <div className="launch">
        {isLaunching ? (
          <button className="launch-main danger" onClick={onKill}>
            <IconStop />
            {t('launch.cancelLaunch')}
          </button>
        ) : isRunning ? (
          <button className="launch-main danger" onClick={onKill} title={t('launch.forceStop')}>
            <IconStop />
            {t('launch.forceStop')}
          </button>
        ) : (
          <button className="launch-main" disabled={!canLaunch} onClick={onLaunch}>
            <IconPlay />
            {t('home.launch')}
          </button>
        )}
        <div className="launch-sub">
          {project ? `${project.versionId || project.mcVersion} · ${project.loader.toUpperCase()}` : t('home.noProject')}
        </div>
        <div className="row-2">
          <button className="btn sm" onClick={onPickProject}>
            {t('side.versions')}
          </button>
          <button className="btn sm" onClick={onOpenInstance} disabled={!project}>
            {t('side.projectSettings')}
          </button>
        </div>
        <div className="side-build">v{appVersion} · {__BUILD_TIME__}</div>
      </div>

      {cropData && (
        <AvatarCrop
          dataUrl={cropData}
          onCancel={() => setCropData('')}
          onDone={(d) => void saveAvatar(d)}
        />
      )}
    </div>
  )
}
