import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
import type { AppState } from '@shared/types'
import type { InstallProgress, VersionSummary } from '@shared/mclib'
import { LoaderPanel } from '@/components/LoaderPanel'
import { ResourceBrowser } from '@/components/ResourceBrowser'

const TABS = [
  ['download.game', 'game'],
  ['download.loaders', 'loader'],
  ['resources.mods', 'mod'],
  ['resources.modpacks', 'modpack'],
  ['resources.shaders', 'shader'],
  ['resources.resourcepacks', 'resourcepack']
] as const

type Kind = 'all' | 'release' | 'snapshot' | 'old'

export function Download({ state }: { state: AppState }): React.ReactElement {
  const { t } = useI18n()
  const [tab, setTab] = useState<string>('game')
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [kind, setKind] = useState<Kind>('release')
  const [query, setQuery] = useState('')
  const [progress, setProgress] = useState<Record<string, InstallProgress>>({})
  const [installed, setInstalled] = useState<{ id: string; type: string; installedAt: number }[]>([])

  const refreshInstalled = useCallback(() => {
    window.api.mc.installed().then(setInstalled)
  }, [])

  useEffect(() => {
    refreshInstalled()
    const off = window.api.mc.onInstallProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.versionId]: p }))
      if (p.stage === 'done' || p.stage === 'error') refreshInstalled()
    })
    return off
  }, [refreshInstalled])

  useEffect(() => {
    if (tab !== 'game' || versions.length) return
    setLoading(true)
    window.api.mc
      .manifest()
      .then((m) => setVersions(m.versions))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [tab, versions.length])

  const installedIds = useMemo(() => new Set(installed.map((v) => v.id)), [installed])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return versions.filter((v) => {
      const kindOk =
        kind === 'all' ||
        (kind === 'release' && v.type === 'release') ||
        (kind === 'snapshot' && v.type === 'snapshot') ||
        (kind === 'old' && (v.type === 'old_beta' || v.type === 'old_alpha'))
      const qOk = !q || v.id.toLowerCase().includes(q)
      return kindOk && qOk
    })
  }, [versions, kind, query])

  const install = (id: string): void => {
    void window.api.mc.install(id)
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('nav.download')}</div>
        <div className="page-desc">{t('download.desc')}</div>
        <div className="spacer" />
        <span className="tag">{state.settings.downloadSource === 'mirror' ? t('settings.mirror') : t('settings.official')}</span>
      </div>

      <div className="subtabs">
        {TABS.map(([key, id]) => (
          <button key={id} className={'subtab' + (tab === id ? ' active' : '')} onClick={() => setTab(id)}>
            {t(key)}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {tab === 'game' && (
          <input
            className="input"
            style={{ width: 200, height: 32 }}
            placeholder={t('download.searchVersion')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>

      {tab === 'game' && (
        <>
          <div className="filters" style={{ marginBottom: 14 }}>
            {(
              [
                ['download.all', 'all'],
                ['versions.release', 'release'],
                ['versions.snapshot', 'snapshot'],
                ['versions.old', 'old']
              ] as [string, Kind][]
            ).map(([key, k]) => (
              <button key={k} className={'subtab' + (kind === k ? ' active' : '')} onClick={() => setKind(k)}>
                {t(key)}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            {loading && <span className="dim" style={{ fontSize: 12 }}>{t('common.loading')}</span>}
            {!loading && <span className="dim" style={{ fontSize: 12 }}>{filtered.length} {t('download.count')}</span>}
          </div>

          {error && <div className="empty" style={{ color: 'var(--err)' }}>{error}</div>}

          <div className="vlist" style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
            {filtered.slice(0, 200).map((v) => {
              const p = progress[v.id]
              const busy = p && p.stage !== 'done' && p.stage !== 'error'
              return (
                <div className="vrow" key={v.id}>
                  <span className="vid">{v.id}</span>
                  <span className={'tag' + (v.type === 'release' ? ' accent' : '')}>
                    {v.type === 'release' ? t('versions.release') : v.type === 'snapshot' ? t('versions.snapshot') : t('versions.old')}
                  </span>
                  <span className="vmeta">{v.releaseTime.slice(0, 10)}</span>
                  <span className="vspacer" />
                  {busy ? (
                    <div className="vprogress">
                      <div className="bar">
                        <i style={{ width: `${p.total ? Math.round((p.done / p.total) * 100) : 0}%` }} />
                      </div>
                      <span className="dim" style={{ fontSize: 11 }}>
                        {stageLabel(p, t)} {p.done}/{p.total}
                      </span>
                    </div>
                  ) : installedIds.has(v.id) ? (
                    <span className="tag ok">{t('download.installed')}</span>
                  ) : p?.stage === 'error' ? (
                    <span className="tag" style={{ color: 'var(--err)' }} title={p.message}>
                      {t('download.failed')}
                    </span>
                  ) : (
                    <button className="btn sm" onClick={() => install(v.id)}>
                      {t('common.download')}
                    </button>
                  )}
                </div>
              )
            })}
            {!loading && !error && filtered.length === 0 && (
              <div className="empty" style={{ border: 0 }}>
                {t('download.empty')}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'loader' && (
        <LoaderPanel
          onInstalled={() => {
            refreshInstalled()
          }}
        />
      )}

      {tab !== 'game' && tab !== 'loader' && (
        <ResourceBrowser state={state} kind={tab as 'mod' | 'modpack' | 'shader' | 'resourcepack'} />
      )}
    </>
  )
}

function stageLabel(p: InstallProgress, t: (k: string) => string): string {
  switch (p.stage) {
    case 'prepare':
      return t('download.stagePrepare')
    case 'client':
      return t('download.stageClient')
    case 'libraries':
      return t('download.stageLibraries')
    case 'assets':
      return t('download.stageAssets')
    default:
      return ''
  }
}
