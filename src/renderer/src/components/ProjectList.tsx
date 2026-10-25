import React, { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
import type { AppState, ComponentLoader, GameProject } from '@shared/types'
import { IconPlus } from './Icons'

type Stats = { id: string; modCount: number; saveCount: number; lastPlayedAt: number; createdAt: number }

const LOADERS: { id: ComponentLoader; label: string }[] = [
  { id: 'vanilla', label: '原版' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'quilt', label: 'Quilt' },
  { id: 'forge', label: 'Forge' },
  { id: 'neoforge', label: 'NeoForge' }
]

/** 版本选择：历史实例（按最后游玩排序）+ 新建实例（同一个 MC 版本可以建多个不同模组组合） */
export function ProjectList({
  state,
  onClose,
  onChanged,
  onOpenInstance
}: {
  state: AppState
  onClose: () => void
  onChanged: () => void
  onOpenInstance: (id: string) => void
}): React.ReactElement {
  const { t } = useI18n()
  const [mode, setMode] = useState<'list' | 'create'>('list')
  const [stats, setStats] = useState<Record<string, Stats>>({})
  const [installed, setInstalled] = useState<{ id: string; type: string }[]>([])
  const [base, setBase] = useState('')
  const [loader, setLoader] = useState<ComponentLoader>('vanilla')
  const [loaderVersions, setLoaderVersions] = useState<{ version: string }[]>([])
  const [loaderVersion, setLoaderVersion] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [folders, setFolders] = useState<{ path: string; label: string }[]>([])

  useEffect(() => {
    void window.api.launcher.folders().then(setFolders)
  }, [state.projects.length])

  const loadStats = (): void => {
    void window.api.instance.stats().then((list) => {
      const map: Record<string, Stats> = {}
      for (const s of list) map[s.id] = s
      setStats(map)
    })
  }

  useEffect(() => {
    loadStats()
  }, [state.projects.length, mode])

  const sorted = useMemo(() => {
    return [...state.projects].sort((a, b) => {
      const sa = stats[a.id]?.lastPlayedAt ?? a.lastPlayedAt ?? a.createdAt
      const sb = stats[b.id]?.lastPlayedAt ?? b.lastPlayedAt ?? b.createdAt
      return sb - sa
    })
  }, [state.projects, stats])

  useEffect(() => {
    if (mode !== 'create') return
    void window.api.mc.installed().then((list) => {
      setInstalled(list)
      if (list.length && !base) {
        setBase(list[0].id)
        setName('')
      }
    })
  }, [mode, base])

  // 选加载器后取可用版本
  useEffect(() => {
    if (mode !== 'create' || !base || loader === 'vanilla') {
      setLoaderVersions([])
      setLoaderVersion('')
      return
    }
    void window.api.loader.list(loader, base).then((r) => {
      const list = (r.list as { version: string }[]) || []
      setLoaderVersions(list)
      setLoaderVersion(list[0]?.version ?? '')
      if (!r.ok) setMsg(r.message || '')
    })
  }, [mode, base, loader])

  const fmt = (ts?: number): string =>
    ts && ts > 1e11 ? new Date(ts).toLocaleString() : t('home.never')

  const activate = async (id: string): Promise<void> => {
    await window.api.project.setActive(id)
    onChanged()
    onClose()
  }

  const remove = async (p: GameProject): Promise<void> => {
    await window.api.project.remove(p.id)
    onChanged()
    loadStats()
  }

  const create = async (): Promise<void> => {
    if (!base) return
    setBusy(true)
    setMsg('')
    const projectName = name.trim() || `${base}${loader === 'vanilla' ? '' : ' ' + loader}`
    if (loader === 'vanilla') {
      await window.api.project.create(projectName, base, 'vanilla')
    } else {
      const r = await window.api.loader.install(loader, base, loaderVersion, projectName)
      if (!r.ok) setMsg(r.message || '创建失败')
    }
    setBusy(false)
    onChanged()
    loadStats()
    setMode('list')
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" style={{ width: 760 }}>
        {mode === 'list' ? (
          <div className="pl-shell">
            <div className="pl-side">
              <div className="card-title">{t('projects.folders')}</div>
              {folders.map((f) => (
                <div key={f.path} className="pl-folder">
                  <div style={{ fontSize: 12.5, fontWeight: 560 }}>{f.label.split('\\').pop() || f.label}</div>
                  <div className="mono dim ellipsis" style={{ fontSize: 10.5 }} title={f.path}>
                    {f.path}
                  </div>
                </div>
              ))}
              <div className="card-title" style={{ marginTop: 16 }}>
                {t('projects.addOrImport')}
              </div>
              <button
                className="btn sm block"
                style={{ marginBottom: 8 }}
                onClick={() => void window.api.launcher.addFolder().then(() => window.api.launcher.folders().then(setFolders))}
              >
                <IconPlus /> {t('projects.addFolder')}
              </button>
              <button
                className="btn sm block"
                onClick={() =>
                  void window.api.launcher.importPack().then((r) => {
                    if (r.ok) {
                      onChanged()
                      onClose()
                    } else if (r.message && r.message !== '已取消') {
                      setMsg(r.message)
                    }
                  })
                }
              >
                {t('projects.importPack')}
              </button>
              {msg && (
                <div style={{ color: 'var(--err)', fontSize: 11.5, marginTop: 10, lineHeight: 1.6 }}>{msg}</div>
              )}
            </div>

            <div className="pl-main">
              <div className="row-between" style={{ marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 15 }}>{t('projects.title')}</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn sm" onClick={() => setMode('create')}>
                    <IconPlus />
                    {t('projects.new')}
                  </button>
                  <button className="btn sm" onClick={onClose} title={t('common.close')}>
                    ✕
                  </button>
                </div>
              </div>

              <div className="vlist" style={{ maxHeight: 400, overflowY: 'auto' }}>
                {sorted.length === 0 && <div className="empty" style={{ border: 0 }}>{t('home.noProject')}</div>}
                {sorted.map((p) => {
                  const active = p.id === state.activeProjectId
                  const st = stats[p.id]
                  return (
                    <div className="vrow" key={p.id} style={active ? { background: 'rgba(127,182,155,0.08)' } : undefined}>
                      <div className="inst-icon">{p.icon && p.icon !== 'auto' ? p.icon : p.name.slice(0, 1)}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 560, display: 'flex', alignItems: 'center', gap: 8 }}>
                          {p.favorite && <span style={{ color: 'var(--warn)' }}>★</span>}
                          {p.name}
                          {active && <span className="tag ok">{t('projects.current')}</span>}
                        </div>
                        <div className="dim" style={{ fontSize: 11 }}>
                          {t('versions.release')} {p.mcVersion}
                          {p.loader !== 'vanilla' ? ` · ${p.loader} ${p.loaderVersion ?? ''}` : ''} · {t('projects.mods')}{' '}
                          {st?.modCount ?? 0} · {t('home.lastPlayed')} {fmt(st?.lastPlayedAt || p.lastPlayedAt)}
                        </div>
                      </div>
                      <button className="btn sm" onClick={() => onOpenInstance(p.id)}>
                        {t('side.projectSettings')}
                      </button>
                      <button className="btn sm" disabled={active} onClick={() => void activate(p.id)}>
                        {t('projects.switch')}
                      </button>
                      <button className="btn sm" onClick={() => void remove(p)}>
                        {t('common.delete')}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <>
            <h2>{t('project.create')}</h2>
            <p className="dim" style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 14 }}>
              {t('projects.createHint')}
            </p>
            <div className="field">
              <label>{t('home.projectName')}</label>
              <input className="input" value={name} placeholder="例如：机械动力整合 / 纯净生存" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('loader.base')}</label>
              <select className="select" value={base} onChange={(e) => setBase(e.target.value)}>
                {installed.length === 0 && <option value="">{t('loader.noBase')}</option>}
                {installed.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id} · {v.type}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t('loader.type')}</label>
              <div className="filters">
                {LOADERS.map((l) => (
                  <button
                    key={l.id}
                    className={'subtab' + (loader === l.id ? ' active' : '')}
                    onClick={() => setLoader(l.id)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            {loader !== 'vanilla' && (
              <div className="field">
                <label>{t('loader.version')}</label>
                <select className="select" value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)}>
                  {loaderVersions.length === 0 && <option value="">{t('common.none')}</option>}
                  {loaderVersions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {msg && <div style={{ color: 'var(--err)', fontSize: 12, marginBottom: 8 }}>{msg}</div>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setMode('list')}>
                {t('common.cancel')}
              </button>
              <button className="btn primary" disabled={!base || busy} onClick={() => void create()}>
                {busy ? t('loader.installing') : t('common.create')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
