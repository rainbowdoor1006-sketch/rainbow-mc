import React from 'react'
import { useI18n } from '@/i18n'
import { IconDownload } from './Icons'

export interface LatestInfoView {
  version: string
  versionCode: number
  downloadUrl: string
  sha256: string
  size: number
  notes?: string
  mandatory?: boolean
  publishedAt?: string
}

export type UpdateMode = 'newer' | 'preview'

function fmtSize(n: number): string {
  if (!n) return ''
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

/** 更新弹窗：newer = 官网有新版本；preview = 本地比官网新（先行版警告） */
export function UpdateDialog({
  mode,
  localVersion,
  latest,
  progress,
  error,
  onUpdate,
  onSkip,
  onContinue,
  onQuit
}: {
  mode: UpdateMode
  localVersion: string
  latest?: LatestInfoView
  progress?: { loaded: number; total: number } | null
  error?: string
  onUpdate: () => void
  onSkip: () => void
  onContinue: () => void
  onQuit: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.loaded / progress.total) * 100) : 0

  if (mode === 'preview') {
    return (
      <div className="overlay" style={{ zIndex: 240 }}>
        <div className="modal" style={{ width: 460 }}>
          <h2 style={{ fontSize: 18 }}>{t('update.previewTitle')}</h2>
          <p style={{ lineHeight: 1.9, fontSize: 13 }}>
            当前版本 <b>{localVersion}</b> 比官网版本 <b>{latest?.version}</b> 更新。
          </p>
          <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
            {t('update.previewHint')}
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={onQuit}>
              {t('update.quit')}
            </button>
            <button className="btn primary" onClick={onContinue}>
              {t('update.continue')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="overlay" style={{ zIndex: 240 }}>
      <div className="modal" style={{ width: 500 }}>
        <div className="modal-icon" style={{ background: 'rgba(127,182,155,.12)', color: 'var(--accent)' }}>
          <IconDownload />
        </div>
        <h2>
          {t('update.title')} {latest?.version}
        </h2>
        <p style={{ marginBottom: 10 }}>
          {t('update.current')}：{localVersion} → {t('update.latest')}：{latest?.version}
          {latest?.size ? <span className="dim"> （{fmtSize(latest.size)}）</span> : null}
        </p>
        {latest?.notes && (
          <div
            className="dim"
            style={{ fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 170, overflowY: 'auto' }}
          >
            {latest.notes}
          </div>
        )}
        {latest?.mandatory && (
          <p style={{ color: 'var(--warn)', fontSize: 12, marginTop: 8 }}>{t('update.mandatory')}</p>
        )}

        {progress && (
          <div style={{ marginTop: 14 }}>
            <div className="dl-orb-bar" style={{ height: 6 }}>
              <div style={{ width: `${pct}%` }} />
            </div>
            <div className="dim mono" style={{ fontSize: 11.5, marginTop: 6 }}>
              {pct.toFixed(0)}% · {fmtSize(progress.loaded)} / {fmtSize(progress.total)}
            </div>
          </div>
        )}
        {error && (
          <p style={{ color: 'var(--danger, #e06666)', fontSize: 12, marginTop: 10, lineHeight: 1.7 }}>{error}</p>
        )}

        <div className="modal-actions">
          {!latest?.mandatory && !progress && (
            <button className="btn" onClick={onSkip}>
              {t('update.noThanks')}
            </button>
          )}
          <button className="btn primary" onClick={onUpdate} disabled={Boolean(progress)}>
            <IconDownload />
            {progress ? t('update.downloading') : t('update.download')}
          </button>
        </div>
      </div>
    </div>
  )
}
