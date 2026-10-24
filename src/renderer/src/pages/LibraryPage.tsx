import React, { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'

interface Entry {
  id: string
  title: string
  kind: string
  versionNumber: string
  fileName: string
  loaders: string[]
  gameVersions: string[]
  size: number
  downloadedAt: number
}

const KIND_LABEL: Record<string, string> = {
  mod: 'resources.mods',
  modpack: 'resources.modpacks',
  shader: 'resources.shaders',
  resourcepack: 'resources.resourcepacks'
}

/** 组件库：下载过的组件都在这里，可删除 / 查看被哪些项目使用 / 从项目中移除 */
export function LibraryPage(): React.ReactElement {
  const { t } = useI18n()
  const [list, setList] = useState<Entry[]>([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [msg, setMsg] = useState('')
  const [zhMap, setZhMap] = useState<Record<string, string>>({})

  const [usageFor, setUsageFor] = useState<Entry | null>(null)
  const [usage, setUsage] = useState<{ id: string; name: string; has: boolean }[]>([])

  const [applyFor, setApplyFor] = useState<Entry | null>(null)
  const [projects, setProjects] = useState<{ id: string; name: string; mcVersion: string }[]>([])
  const [delFor, setDelFor] = useState<{ entry: Entry; usedBy: { id: string; name: string; has: boolean }[] } | null>(
    null
  )

  const reload = async (): Promise<void> => {
    const all = (await window.api.library.list()) as Entry[]
    setList(all)
    if (!all.length) return
    // 有中文名的组件显示「英文（中文）」
    const r = await window.api.zh.batch(all.map((e) => ({ slug: (e as { slug?: string }).slug || '', title: e.title })))
    if (r.ok) setZhMap(r.map)
  }

  useEffect(() => {
    void reload()
  }, [])

  const openApply = async (e: Entry): Promise<void> => {
    const s = (await window.api.getState()) as { projects: { id: string; name: string; mcVersion: string }[] }
    setProjects(s.projects)
    setApplyFor(e)
  }

  const applyLoaderTo = async (projectId: string): Promise<void> => {
    if (!applyFor) return
    const r = await window.api.library.applyLoader(applyFor.id, projectId)
    if (!r.ok) {
      setMsg(r.message || '应用失败')
      return
    }
    setMsg(t('library.appliedLoader'))
    setApplyFor(null)
  }

  const openUsage = async (e: Entry): Promise<void> => {
    setUsageFor(e)
    setUsage((await window.api.library.usageDetail(e.id)) as never)
  }

  const askDelete = async (e: Entry): Promise<void> => {
    const detail = (await window.api.library.usageDetail(e.id)) as { id: string; name: string; has: boolean }[]
    const used = detail.filter((u) => u.has)
    if (used.length) {
      setDelFor({ entry: e, usedBy: used })
      return
    }
    await window.api.library.remove(e.id)
    setMsg(`${t('library.deleted')} ${e.title}`)
    void reload()
  }

  const deleteEverywhere = async (): Promise<void> => {
    if (!delFor) return
    for (const u of delFor.usedBy) {
      await window.api.library.removeFromProject(delFor.entry.id, u.id)
    }
    await window.api.library.remove(delFor.entry.id)
    setMsg(`${t('library.deletedEverywhere')}：${delFor.entry.title}`)
    setDelFor(null)
    void reload()
  }

  const deleteLibraryOnly = async (): Promise<void> => {
    if (!delFor) return
    await window.api.library.remove(delFor.entry.id)
    setMsg(`${t('library.deletedLibraryOnly')}：${delFor.entry.title}`)
    setDelFor(null)
    void reload()
  }

  const removeFrom = async (entryId: string, projectId: string): Promise<void> => {
    const r = await window.api.library.removeFromProject(entryId, projectId)
    if (!r.ok) {
      setMsg(r.message || '移除失败')
      return
    }
    setUsage((await window.api.library.usageDetail(entryId)) as never)
    setMsg(t('library.removedFromProject'))
  }

  const shown = list.filter(
    (e) =>
      (kind === 'all' || e.kind === kind) &&
      (!query || e.title.toLowerCase().includes(query.toLowerCase()))
  )

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('library.title')}</div>
        <div className="page-desc">{t('library.desc')}</div>
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ width: 240 }}
          placeholder={t('library.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="select" style={{ width: 150 }} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">{t('library.allKinds')}</option>
          <option value="mod">{t('resources.mods')}</option>
          <option value="shader">{t('resources.shaders')}</option>
          <option value="resourcepack">{t('resources.resourcepacks')}</option>
          <option value="modpack">{t('resources.modpacks')}</option>
        </select>
        <span className="dim" style={{ fontSize: 12, alignSelf: 'center' }}>
          {shown.length} / {list.length}
        </span>
      </div>

      {!shown.length && <div className="empty">{t('library.empty')}</div>}

      <div className="lib-grid">
        {shown.map((e) => (
          <div className="lib-card" key={e.id}>
            <div className="row-between" style={{ alignItems: 'flex-start', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div className="lib-title">
                  {e.title}
                  {zhMap[e.title] && zhMap[e.title] !== e.title && (
                    <span className="res-zh">（{zhMap[e.title]}）</span>
                  )}
                </div>
                <div className="lib-meta">
                  {t(KIND_LABEL[e.kind] || 'library.title')} · {e.versionNumber} ·{' '}
                  {(e.size / 1024 / 1024).toFixed(1)} MB
                </div>
                <div className="lib-meta">
                  {e.loaders.join(' / ') || 'vanilla'} · {e.gameVersions.slice(0, 4).join(', ')}
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                {e.kind === 'loader' && (
                  <button className="btn sm" onClick={() => void openApply(e)}>
                    {t('library.applyToProject')}
                  </button>
                )}
                <button className="btn sm" onClick={() => void openUsage(e)}>
                  {t('library.usedBy')}
                </button>
                <button className="btn sm" onClick={() => void askDelete(e)}>
                  {t('library.delete')}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {msg && (
        <div className="dim" style={{ fontSize: 12, marginTop: 12 }}>
          {msg}
        </div>
      )}

      {applyFor && (
        <div className="overlay" style={{ zIndex: 210 }}>
          <div className="modal" style={{ width: 480, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>
                {t('library.applyToProject')} · {applyFor.title}
              </h2>
              <button className="win-btn" style={{ width: 26, height: 26 }} onClick={() => setApplyFor(null)}>
                ✕
              </button>
            </div>
            <div className="lib-modal-list">
              {projects.map((p) => (
                <div key={p.id} className="dep-row">
                  <span>
                    {p.name}
                    <span className="dim" style={{ fontSize: 11, marginLeft: 6 }}>
                      {p.mcVersion}
                    </span>
                  </span>
                  {applyFor.gameVersions.includes(p.mcVersion) ? (
                    <button className="btn sm" onClick={() => void applyLoaderTo(p.id)}>
                      {t('library.applyToProject')}
                    </button>
                  ) : (
                    <span className="tag">{t('library.mismatch')}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {usageFor && (
        <div className="overlay" style={{ zIndex: 210 }}>
          <div className="modal" style={{ width: 520, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>
                {t('library.usedBy')} · {usageFor.title}
              </h2>
              <button className="win-btn" style={{ width: 26, height: 26 }} onClick={() => setUsageFor(null)}>
                ✕
              </button>
            </div>
            <div className="lib-modal-list">
              {!usage.length && <div className="dim" style={{ fontSize: 12 }}>{t('library.noProjects')}</div>}
              {usage.map((u) => (
                <div key={u.id} className="dep-row">
                  <span>{u.name}</span>
                  {u.has ? (
                    <button className="btn sm" onClick={() => void removeFrom(usageFor.id, u.id)}>
                      {t('library.removeFromProject')}
                    </button>
                  ) : (
                    <span className="tag">{t('library.notInProject')}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {delFor && (
        <div className="overlay" style={{ zIndex: 210 }}>
          <div className="modal" style={{ width: 540 }}>
            <h2 style={{ fontSize: 16 }}>{t('library.delTitle')}</h2>
            <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.9, margin: '10px 0 12px' }}>
              「{delFor.entry.title}」{t('library.delBody')}
            </p>
            <div className="lib-modal-list" style={{ maxHeight: 200 }}>
              {delFor.usedBy.map((u) => (
                <div key={u.id} className="dep-row">
                  <span>{u.name}</span>
                  <span className="tag ok">{t('library.installed')}</span>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => void deleteLibraryOnly()}>
                {t('library.keepProjects')}
              </button>
              <button className="btn primary" onClick={() => void deleteEverywhere()}>
                {t('library.delEverywhere')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
