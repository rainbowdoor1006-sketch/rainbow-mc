import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
import { ComponentDetail } from './ComponentDetail'
import type { AppState } from '@shared/types'
import { popularityScore, zhNameFor } from '@shared/zhnames'
import { IconDownload } from './Icons'

type Kind = 'mod' | 'modpack' | 'shader' | 'resourcepack'

interface Hit {
  project_id: string
  slug: string
  title: string
  description: string
  icon_url: string | null
  downloads: number
  follows?: number
  categories: string[]
  date_created?: string
}

interface Issue {
  level: 'error' | 'warn'
  code: string
  message: string
}

interface Entry {
  projectId: string
  title: string
  versionNumber: string
  fileName: string
  kind: Kind
}

const LOADERS = ['any', 'fabric', 'quilt', 'forge', 'neoforge'] as const
const PAGE = 40

export function ResourceBrowser({ state, kind }: { state: AppState; kind: Kind }): React.ReactElement {
  const { t } = useI18n()
  const project = state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0]

  const [query, setQuery] = useState('')
  // 默认「不按项目筛选」：没有项目也能浏览/下载；勾选后才套用当前项目的版本与加载器
  const [useProjectFilter, setUseProjectFilter] = useState(false)
  const [mcVersion, setMcVersion] = useState('any')
  const [loader, setLoader] = useState<string>('any')
  const [year, setYear] = useState('any')
  const [month, setMonth] = useState('any')

  const [hits, setHits] = useState<Hit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [detail, setDetail] = useState<Hit | null>(null)
  const [message, setMessage] = useState('')
  const [issues, setIssues] = useState<Issue[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [page, setPage] = useState(0)
  const [zhMap, setZhMap] = useState<Record<string, string>>({})
  const [allVersions, setAllVersions] = useState<string[]>([])

  useEffect(() => {
    if (!useProjectFilter || !project) {
      setMcVersion('any')
      setLoader('any')
      return
    }
    setMcVersion(project.mcVersion)
    setLoader(project.loader !== 'vanilla' ? project.loader : 'any')
  }, [useProjectFilter, project])

  useEffect(() => {
    // 版本筛选要用「全部 Minecraft 版本」，不只是装过的
    window.api.mc
      .manifest()
      .then((m) => setAllVersions(m.versions.map((v) => v.id)))
      .catch(() => setAllVersions([]))
  }, [])

  const loadZh = useCallback(async (list: Hit[]) => {
    const items = list
      .filter((h) => !zhNameFor(h.slug, h.title))
      .map((h) => ({ slug: h.slug, title: h.title }))
    if (!items.length) return
    const r = await window.api.zh.batch(items)
    if (r.ok && Object.keys(r.map).length) setZhMap((prev) => ({ ...prev, ...r.map }))
  }, [])

  const mcOptions = useMemo(() => {
    const list = new Set<string>()
    if (project?.mcVersion) list.add(project.mcVersion)
    for (const p of state.projects) list.add(p.mcVersion)
    for (const v of allVersions) list.add(v)
    return ['any', ...[...list].filter(Boolean)]
  }, [state.projects, project?.mcVersion, allVersions])

  const years = useMemo(() => {
    const now = new Date().getFullYear()
    const out = ['any']
    for (let y = now; y >= 2011; y--) out.push(String(y))
    return out
  }, [])

  const hasDateFilter = year !== 'any'

  const refreshInstalled = useCallback(() => {
    if (!project) return
    void window.api.mods.list(project.id).then((r) => {
      setEntries(r.entries as Entry[])
      setIssues(r.issues as Issue[])
    })
  }, [project])

  const fetchPage = useCallback(
    async (nextPage: number, append: boolean) => {
      setLoading(true)
      setMessage('')
      const r = await window.api.modrinth.search(
        kind,
        query,
        loader,
        mcVersion,
        nextPage * PAGE,
        {
          limit: PAGE,
          index: hasDateFilter ? 'newest' : query ? 'relevance' : 'downloads'
        }
      )
      setLoading(false)
      if (!r.ok) {
        setMessage(r.message || '搜索失败')
        if (!append) setHits([])
        return
      }
      const list = (r.hits as Hit[]) || []
      const ranked = !query
        ? [...list].sort(
            (a, b) =>
              popularityScore(b.slug, b.downloads, b.follows ?? 0, b.categories) -
              popularityScore(a.slug, a.downloads, a.follows ?? 0, a.categories)
          )
        : list
      setHits((prev) => (append ? [...prev, ...ranked] : ranked))
      void loadZh(ranked)
      setTotal(r.total_hits || 0)
      setPage(nextPage)
    },
    [kind, query, loader, mcVersion, hasDateFilter]
  )

  useEffect(() => {
    refreshInstalled()
    void fetchPage(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, project?.id])

  const filtered = useMemo(() => {
    if (!hasDateFilter) return hits
    return hits.filter((h) => {
      if (!h.date_created) return false
      const d = new Date(h.date_created)
      if (d.getFullYear() !== Number(year)) return false
      if (month !== 'any' && d.getMonth() + 1 !== Number(month)) return false
      return true
    })
  }, [hits, year, month, hasDateFilter])

  const install = async (hit: Hit): Promise<void> => {
    setBusy(hit.project_id)
    setMessage('')
    // 没项目时完全不套用项目条件，交给筛选器（可能是 any）
    const useLoader = loader === 'any' ? undefined : loader
    const useMc = mcVersion === 'any' ? undefined : mcVersion
    const vr = await window.api.modrinth.versions(hit.project_id, useLoader, useMc)
    if (!vr.ok) {
      setBusy(null)
      setMessage(vr.message || '获取版本失败')
      return
    }
    const list = (vr.list as { id: string }[]) || []
    if (!list.length) {
      setBusy(null)
      setMessage(t('resources.noCompatibleVersion'))
      return
    }
    // 2026-10-21：下载 = 存进「组件库」，不再直接装进当前项目
    // 没有项目时传空 id：组件库照样收，之后可以再应用到任意项目
    const r = await window.api.library.download({
      projectId: project?.id ?? '',
      title: hit.title,
      kind,
      versionId: list[0].id,
      iconUrl: hit.icon_url || undefined
    })
    setBusy(null)
    if (!r.ok) {
      setMessage(r.message || '下载失败')
      return
    }
    setMessage(`${t('resources.downloaded')}：${hit.title}`)
  }

  const remove = async (fileName: string): Promise<void> => {
    if (!project) return
    const r = await window.api.mods.remove(project.id, fileName)
    setEntries(r.entries as Entry[])
    setIssues(r.issues as Issue[])
  }

  return (
    <>
      <div className="filter-bar">
        {project && (
          <label
            className="row"
            style={{ gap: 6, fontSize: 12, color: 'var(--txt-dim)', whiteSpace: 'nowrap' }}
            title={`${project.name} · ${project.mcVersion} · ${project.loader}`}
          >
            <input
              type="checkbox"
              checked={useProjectFilter}
              onChange={(e) => setUseProjectFilter(e.target.checked)}
            />
            按当前项目筛选
          </label>
        )}
        <input
          className="input"
          style={{ width: 220, height: 32 }}
          placeholder={t('resources.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void fetchPage(0, false)
          }}
        />
        <select className="select" style={{ height: 32, width: 132 }} value={mcVersion} onChange={(e) => setMcVersion(e.target.value)}>
          {mcOptions.map((v) => (
            <option key={v} value={v}>
              {v === 'any' ? t('resources.anyVersion') : v}
            </option>
          ))}
        </select>
        <select className="select" style={{ height: 32, width: 128 }} value={loader} onChange={(e) => setLoader(e.target.value)}>
          {LOADERS.map((l) => (
            <option key={l} value={l}>
              {l === 'any' ? t('resources.anyLoader') : l === 'fabric' ? 'Fabric' : l === 'quilt' ? 'Quilt' : l === 'forge' ? 'Forge' : 'NeoForge'}
            </option>
          ))}
        </select>
        <select className="select" style={{ height: 32, width: 110 }} value={year} onChange={(e) => setYear(e.target.value)}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y === 'any' ? t('resources.anyYear') : y}
            </option>
          ))}
        </select>
        <select className="select" style={{ height: 32, width: 96 }} value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="any">{t('resources.anyMonth')}</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={String(m)}>
              {m} {t('resources.monthUnit')}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={() => void fetchPage(0, false)}>
          {t('common.search')}
        </button>
      </div>

      <div className="dim" style={{ fontSize: 11.5, marginBottom: 12 }}>
        {project ? (
          <>
            {project.name} · {project.loader.toUpperCase()} · {project.mcVersion}
          </>
        ) : (
          <>{t('resources.noProjectFilter')}</>
        )}
        {total ? ` · ${total} ${t('resources.results')}` : ''}
        {hasDateFilter ? ` · ${t('resources.filtered')} ${filtered.length}` : ''}
        {hasDateFilter && <span style={{ marginLeft: 8 }}>（{t('resources.dateHint')}）</span>}
      </div>

      {message && (
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>
          {message}
        </div>
      )}

      {issues.length > 0 && (
        <div className="card tight" style={{ marginBottom: 12, borderColor: 'rgba(201,106,106,.4)' }}>
          <div className="card-title" style={{ color: '#d98b8b' }}>
            {t('mods.issues')}
          </div>
          {issues.map((i, idx) => (
            <div
              key={idx}
              style={{ fontSize: 12.5, lineHeight: 1.9, color: i.level === 'error' ? '#d98b8b' : 'var(--warn)' }}
            >
              · {i.message}
            </div>
          ))}
        </div>
      )}

      <div className="res-grid">
        {filtered.map((h) => (
          <div className="res-card" key={h.project_id} onClick={() => setDetail(h)} style={{ cursor: 'pointer' }}>
            <div className="res-icon">
              {h.icon_url ? <img src={h.icon_url} alt="" /> : <span>{h.title.slice(0, 1)}</span>}
            </div>
            <div className="res-body">
              <div className="res-title">
                {h.title}
                {(zhNameFor(h.slug, h.title) ?? zhMap[h.title]) && (
                  <span className="res-zh">（{zhNameFor(h.slug, h.title) ?? zhMap[h.title]}）</span>
                )}
              </div>
              <div className="res-desc">{h.description}</div>
              <div className="res-meta">
                <span className="mono">{(h.downloads / 1000).toFixed(0)}k</span>
                {h.date_created && <span>{h.date_created.slice(0, 7)}</span>}
                {h.categories.slice(0, 3).map((c) => (
                  <span className="tag" key={c}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <button
              className="btn sm"
              onClick={(e) => {
                e.stopPropagation()
                setDetail(h)
              }}
            >
              {t('common.open')}
            </button>
          </div>
        ))}
        {!filtered.length && !loading && <div className="empty">{t('resources.empty')}</div>}
      </div>

      {detail && (
        <ComponentDetail
          projectId={detail.project_id}
          title={detail.title}
          kind={kind}
          targetProjectId={project?.id}
          targetLoader={project?.loader}
          targetMc={project?.mcVersion}
          onClose={() => setDetail(null)}
          onInstalled={() => refreshInstalled()}
        />
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
        <button className="btn sm" disabled={loading} onClick={() => void fetchPage(page + 1, true)}>
          {loading ? t('common.loading') : t('resources.loadMore')}
        </button>
        <span className="dim" style={{ fontSize: 11.5 }}>
          {t('resources.sourceHint')}
        </span>
      </div>

      {entries.length > 0 && project && (
        <>
          <div className="card-title" style={{ marginTop: 24 }}>
            {t('mods.installedIn')} {project.name}
          </div>
          <div className="vlist">
            {entries.map((e) => (
              <div className="vrow" key={e.fileName}>
                <span className="vid" style={{ minWidth: 180 }}>
                  {e.title}
                </span>
                <span className="tag">{e.kind}</span>
                <span className="vmeta mono">{e.versionNumber}</span>
                <span className="vspacer" />
                <button className="btn sm" onClick={() => void remove(e.fileName)}>
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
