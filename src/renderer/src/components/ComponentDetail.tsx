import React, { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
import { IconDownload, IconFolder } from './Icons'

interface MrVersionLite {
  id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  date_published?: string
}

interface Props {
  projectId: string
  title: string
  kind: 'mod' | 'modpack' | 'shader' | 'resourcepack'
  /** 没有选中项目时全部为空：此时详情页只做浏览/下载，不做兼容性判断 */
  targetProjectId?: string
  targetLoader?: string
  targetMc?: string
  onClose: () => void
  onInstalled: () => void
}

/**
 * 组件主页：显示简介、所有版本（按加载器/游戏版本分组），
 * 选中某个版本后可看前置组件并一键补齐。
 */
export function ComponentDetail({
  projectId,
  title,
  kind,
  targetProjectId,
  targetLoader,
  targetMc,
  onClose,
  onInstalled
}: Props): React.ReactElement {
  const { t } = useI18n()
  const [info, setInfo] = useState<{
    title: string
    description: string
    icon_url?: string | null
    downloads: number
    followers: number
    source_url?: string | null
    wiki_url?: string | null
    categories: string[]
  } | null>(null)
  const [versions, setVersions] = useState<MrVersionLite[]>([])
  const [loading, setLoading] = useState(true)
  const [mcFilter, setMcFilter] = useState('all')
  const [ldFilter, setLdFilter] = useState('all')
  const [sel, setSel] = useState<MrVersionLite | null>(null)
  const [deps, setDeps] = useState<{ projectId: string; title: string; installed: boolean }[]>([])
  const [neededLoader, setNeededLoader] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await window.api.modrinth.projectInfo(projectId)
      if (alive && r.ok && r.info) setInfo(r.info as never)
      const lib = ((await window.api.library.list()) as unknown) as { projectId: string; versionId: string }[]
      const map: Record<string, boolean> = {}
      for (const e of lib) if (e.projectId === projectId) map[e.versionId] = true
      if (alive) setDownloaded(map)
      const vr = await window.api.modrinth.versions(projectId)
      if (alive) {
        setVersions(((vr.ok ? (vr.list as MrVersionLite[]) : []) || []).slice(0, 200))
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [projectId])

  const mcOptions = useMemo(() => {
    const set = new Set<string>()
    for (const v of versions) v.game_versions.forEach((g) => set.add(g))
    return [...set]
  }, [versions])

  const ldOptions = useMemo(() => {
    const set = new Set<string>()
    for (const v of versions) v.loaders.forEach((g) => set.add(g))
    return [...set]
  }, [versions])

  const shown = versions.filter(
    (v) =>
      (mcFilter === 'all' || v.game_versions.includes(mcFilter)) &&
      (ldFilter === 'all' || v.loaders.includes(ldFilter))
  )

  const pick = async (v: MrVersionLite): Promise<void> => {
    setSel(v)
    setMsg('')
    const r = await window.api.modrinth.depInfo(v.id, projectId, targetProjectId || '')
    if (r.ok) {
      setDeps(r.deps || [])
      setNeededLoader(r.neededLoader || null)
    } else {
      setDeps([])
      setNeededLoader(null)
      setMsg(r.message || '读取前置信息失败')
    }
  }

  const installVersion = async (v: MrVersionLite): Promise<void> => {
    setBusy('install')
    setMsg('')
    const r = await window.api.library.download({
      projectId,
      title,
      kind,
      versionId: v.id
    })
    setBusy('')
    if (!r.ok) {
      setMsg(r.message || '安装失败')
      return
    }
    setMsg(t('resources.downloaded'))
    setDownloaded((d) => ({ ...d, [v.id]: true }))
    onInstalled()
  }

  const installAllDeps = async (): Promise<void> => {
    if (!sel) return
    setBusy('deps')
    setMsg('')
    const r = await window.api.modrinth.installDeps(sel.id, targetProjectId || '')
    setBusy('')
    if (!r.ok) {
      setMsg(r.message || '下载前置失败')
      return
    }
    const a = r.installed?.length ?? 0
    const s = r.skipped?.length ?? 0
    const f = r.failed?.length ?? 0
    setMsg(
      `下载 ${a} 个，跳过已装 ${s} 个` + (f ? `，失败 ${f} 个（${(r.failed || []).join('、')}）` : '')
    )
    const again = await window.api.modrinth.depInfo(sel.id, projectId, targetProjectId || '')
    if (again.ok) setDeps(again.deps || [])
    onInstalled()
  }

  return (
    <div className="overlay" style={{ zIndex: 210 }}>
      <div className="modal" style={{ width: 860, maxHeight: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column' }}>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <div className="res-icon" style={{ width: 44, height: 44 }}>
              {info?.icon_url ? <img src={info.icon_url} alt="" /> : <span>{title.slice(0, 1)}</span>}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 650 }}>{info?.title || title}</div>
              <div className="dim" style={{ fontSize: 12 }}>
                {kind} · {info ? `${(info.downloads / 1000).toFixed(0)}k 下载 · ${info.followers} 关注` : ''}
              </div>
            </div>
          </div>
          <button className="win-btn" style={{ width: 26, height: 26 }} onClick={onClose}>
            ✕
          </button>
        </div>

        {info?.description && (
          <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.8, marginBottom: 10 }}>
            {info.description}
          </p>
        )}

        <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <select className="select" style={{ height: 30, width: 150 }} value={mcFilter} onChange={(e) => setMcFilter(e.target.value)}>
            <option value="all">{t('detail.allMc')}</option>
            {mcOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select className="select" style={{ height: 30, width: 130 }} value={ldFilter} onChange={(e) => setLdFilter(e.target.value)}>
            <option value="all">{t('detail.allLoader')}</option>
            {ldOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="dim" style={{ fontSize: 12, alignSelf: 'center' }}>
            {t('detail.versionCount').replace('{n}', String(shown.length))}
          </span>
          {(info?.source_url || info?.wiki_url) && (
            <button
              className="btn sm"
              onClick={() => void window.api.update.open((info?.source_url || info?.wiki_url) as string)}
            >
              <IconFolder />
              {t('detail.homepage')}
            </button>
          )}
        </div>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 12, minHeight: 0 }}>
          <div className="detail-list">
            {loading && <div className="empty">{t('common.loading')}</div>}
            {!loading && !shown.length && <div className="empty">{t('resources.noCompatibleVersion')}</div>}
            {shown.map((v) => (
              <div
                key={v.id}
                className={'detail-row' + (sel?.id === v.id ? ' active' : '')}
                onClick={() => void pick(v)}
              >
                <div>
                  <div className="detail-row-title">{v.version_number}</div>
                  <div className="detail-row-meta">
                    {v.loaders.join(' / ') || 'vanilla'}
                    {v.game_versions.length ? ` · ${v.game_versions.slice(0, 3).join(', ')}` : ''}
                    {v.date_published ? ` · ${v.date_published.slice(0, 10)}` : ''}
                  </div>
                </div>
                {downloaded[v.id] && (
                  <span className="tag ok" style={{ fontSize: 11 }}>
                    {t('resources.alreadyDownloaded')}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="detail-side">
            {!sel && <div className="empty">{t('detail.pickVersion')}</div>}
            {sel && (
              <>
                <div className="card-title" style={{ marginBottom: 8 }}>
                  {sel.version_number}
                </div>
                <div className="detail-kv">
                  <span>{t('detail.loader')}</span>
                  <b>{neededLoader || 'vanilla'}</b>
                </div>
                <div className="detail-kv">
                  <span>{t('detail.mcVersion')}</span>
                  <b>{sel.game_versions.slice(0, 4).join(', ')}</b>
                </div>
                <div className="detail-kv">
                  <span>{t('detail.target')}</span>
                  <b>
                    {targetLoader && targetMc ? `${targetLoader.toUpperCase()} · ${targetMc}` : t('detail.noTarget')}
                  </b>
                </div>

                {targetMc && (!sel.game_versions.includes(targetMc) || (neededLoader && targetLoader !== neededLoader)) && (
                  <div className="hint-banner" style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.7 }}>
                    {t('detail.mismatch')}
                  </div>
                )}

                <div className="card-title" style={{ margin: '12px 0 6px' }}>
                  {t('detail.deps')}
                </div>
                {!deps.length && <div className="dim" style={{ fontSize: 12 }}>{t('detail.noDeps')}</div>}
                {deps.map((d) => (
                  <div key={d.projectId} className="dep-row">
                    <span>{d.title}</span>
                    <span className={d.installed ? 'tag ok' : 'tag'}>{d.installed ? t('detail.installed') : t('detail.missing')}</span>
                  </div>
                ))}

                <div className="modal-actions" style={{ marginTop: 12 }}>
                  <button className="btn" disabled={busy === 'deps'} onClick={() => void installAllDeps()}>
                    {busy === 'deps' ? '…' : t('detail.installDeps')}
                  </button>
                  <button
                    className="btn primary"
                    disabled={busy === 'install' || !!downloaded[sel.id]}
                    onClick={() => void installVersion(sel)}
                  >
                    {downloaded[sel.id] ? t('resources.alreadyDownloaded') : t('resources.downloadToLibrary')}
                  </button>
                </div>
              </>
            )}
            {msg && (
              <div className="dim" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.7 }}>
                {msg}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
