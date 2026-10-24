import React, { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { LibraryPicker } from './LibraryPicker'
import type { AppState, GameProject } from '@shared/types'
import { IconDownload, IconFolder, IconGear, IconMore, IconPuzzle, IconWarn } from './Icons'

interface ModFile {
  fileName: string
  enabled: boolean
  size: number
}
interface SaveInfo {
  name: string
  size: number
  mtime: number
}

type Tab = 'overview' | 'settings' | 'modify' | 'mods' | 'export'

const NAV: { id: Tab; key: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'overview', key: 'inst.overview', icon: IconMore },
  { id: 'settings', key: 'inst.settings', icon: IconGear },
  { id: 'modify', key: 'inst.modify', icon: IconPencil },
  { id: 'mods', key: 'inst.mods', icon: IconPuzzle },
  { id: 'export', key: 'inst.export', icon: IconDownload }
]

function IconPencil(p: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4 16z" />
      <path d="M14.5 6.5 17.5 9.5" />
    </svg>
  )
}

const ICONS = ['auto', '🟩', '🔥', '⚙️', '🌲', '🧪', '🏰', '⛏️', '🌊', '🐉']
const CATEGORIES = ['auto', '生存', '整合包', '优化', '建筑', '科技', '冒险', '测试']

export function InstancePanel({
  state,
  project,
  onClose,
  onChanged,
  onGoDownload,
  onGoSettings,
  onDeleted
}: {
  state: AppState
  project: GameProject
  onClose: () => void
  onChanged: () => void
  onGoDownload: () => void
  onGoSettings: () => void
  onDeleted: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('overview')
  const [showPicker, setShowPicker] = useState(false)
  const [mods, setMods] = useState<ModFile[]>([])
  const [saves, setSaves] = useState<SaveInfo[]>([])
  const [modQuery, setModQuery] = useState('')
  const [mem, setMem] = useState({ totalMb: 8192, autoMb: 4096 })
  const [msg, setMsg] = useState('')

  const [name, setName] = useState(project.name)
  const [desc, setDesc] = useState(project.desc ?? '')
  const [icon, setIcon] = useState(project.icon ?? 'auto')
  const [category, setCategory] = useState(project.category ?? 'auto')
  const [favorite, setFavorite] = useState(!!project.favorite)
  const [memoryMode, setMemoryMode] = useState(project.memoryMode ?? 'global')
  const [memoryMb, setMemoryMb] = useState(String(project.memoryMb ?? state.settings.maxMemoryMb))
  const [isolated, setIsolated] = useState(project.isolated !== false)
  const [windowTitle, setWindowTitle] = useState(project.windowTitle ?? '')
  const [joinServer, setJoinServer] = useState(project.joinServer ?? '')
  const [java, setJava] = useState(project.javaPath ?? '')
  const [width, setWidth] = useState(String(project.width ?? ''))
  const [height, setHeight] = useState(String(project.height ?? ''))
  const [jvmArgs, setJvmArgs] = useState(project.jvmArgs ?? '')
  const [gameArgs, setGameArgs] = useState(project.gameArgs ?? '')
  const [exportName, setExportName] = useState(project.name)
  const [packVersion, setPackVersion] = useState('1.0.0')

  const reload = useCallback(async () => {
    const r = await window.api.instance.info(project.id)
    if (r.ok) {
      setMods((r.mods as ModFile[]) || [])
      setSaves((r.saves as SaveInfo[]) || [])
    }
    const m = await window.api.instance.memInfo()
    setMem(m)
  }, [project.id])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = async (patch?: Partial<GameProject>): Promise<void> => {
    await window.api.instance.update(project.id, {
      name: name.trim() || project.name,
      desc: desc.trim(),
      icon,
      category,
      favorite,
      memoryMode,
      memoryMb: Number(memoryMb) || undefined,
      isolated,
      windowTitle: windowTitle.trim(),
      joinServer: joinServer.trim(),
      javaPath: java.trim(),
      width: Number(width) || undefined,
      height: Number(height) || undefined,
      jvmArgs: jvmArgs.trim(),
      gameArgs: gameArgs.trim(),
      ...patch
    })
    onChanged()
    setMsg(t('instance.saved'))
  }

  const removeProject = async (): Promise<void> => {
    await window.api.project.remove(project.id)
    onChanged()
    onDeleted()
  }

  const doExport = async (): Promise<void> => {
    const r = await window.api.instance.export(project.id)
    setMsg(r.ok ? `${t('inst.exportDone')}：${r.path}` : r.message || '')
  }

  const fmt = (ts?: number): string => (ts && ts > 1e11 ? new Date(ts).toLocaleString() : t('home.never'))
  const shownMods = mods.filter((m) => !modQuery || m.fileName.toLowerCase().includes(modQuery.toLowerCase()))
  const enabled = mods.filter((m) => m.enabled).length
  const autoMem = Math.round(memoryMode === 'auto' ? mem.autoMb : Number(memoryMb) || state.settings.maxMemoryMb)
  const memPct = Math.min(100, Math.round((autoMem / Math.max(1, mem.totalMb)) * 100))

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="inst-modal">
        <div className="inst-head">
          <div className="inst-icon" style={{ fontSize: 16 }}>{icon === 'auto' ? project.name.slice(0, 1) : icon}</div>
          <div>
            <div className="title">
              {project.name} {favorite && <span style={{ color: 'var(--warn)' }}>★</span>}
            </div>
            <div className="sub">
              {t('versions.release')} {project.mcVersion}
              {project.loader !== 'vanilla' ? ` · ${project.loader} ${project.loaderVersion ?? ''}` : ''}
            </div>
          </div>
          <div className="spacer" />
          <button className="win-btn" style={{ height: 28, width: 28 }} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="inst-body">
          <div className="inst-nav">
            {NAV.map((n) => {
              const Icon = n.icon
              return (
                <button key={n.id} className={'inst-nav-item' + (tab === n.id ? ' active' : '')} onClick={() => setTab(n.id)}>
                  <Icon />
                  {t(n.key)}
                </button>
              )
            })}
          </div>

          <div className="inst-main">
            {tab === 'overview' && (
              <>
                <div className="inst-card">
                  <h3>{t('inst.personalize')}</h3>
                  <div className="form-row">
                    <label>{t('inst.icon')}</label>
                    <select className="select" value={icon} onChange={(e) => setIcon(e.target.value)}>
                      {ICONS.map((i) => (
                        <option key={i} value={i}>
                          {i === 'auto' ? t('inst.auto') : i}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row">
                    <label>{t('inst.category')}</label>
                    <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c === 'auto' ? t('inst.auto') : c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row">
                    <label>{t('home.projectName')}</label>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="form-row">
                    <label>{t('inst.desc')}</label>
                    <input className="input" placeholder={t('inst.descPlaceholder')} value={desc} onChange={(e) => setDesc(e.target.value)} />
                  </div>
                  <div className="form-row">
                    <label>{t('inst.favorite')}</label>
                    <button className="btn sm" onClick={() => setFavorite(!favorite)}>
                      {favorite ? '★ ' + t('inst.favorited') : '☆ ' + t('inst.addFavorite')}
                    </button>
                  </div>
                </div>

                <div className="inst-card">
                  <h3>{t('inst.shortcuts')}</h3>
                  <div className="quick-grid">
                    <button className="btn" onClick={() => void window.api.instance.openDir(project.id)}>
                      <IconFolder /> {t('inst.folderVersion')}
                    </button>
                    <button className="btn" onClick={() => void window.api.instance.openSavesDir(project.id)}>
                      <IconFolder /> {t('inst.folderSaves')}
                    </button>
                    <button className="btn" onClick={() => void window.api.instance.openModsDir(project.id)}>
                      <IconFolder /> {t('inst.folderMods')}
                    </button>
                    <button className="btn" onClick={() => void window.api.instance.openScreenshotsDir(project.id)}>
                      <IconFolder /> {t('inst.folderScreenshots')}
                    </button>
                  </div>
                </div>

                <div className="inst-card">
                  <h3>{t('inst.advanced')}</h3>
                  <div className="quick-grid">
                    <button
                      className="btn"
                      onClick={() => void window.api.instance.exportScript(project.id).then((r) => setMsg(r.ok ? `${t('inst.scriptDone')}：${r.path}` : r.message || ''))}
                    >
                      {t('inst.exportScript')}
                    </button>
                    <button
                      className="btn"
                      onClick={() => void window.api.instance.repair(project.id).then((r) => setMsg(r.ok ? t('inst.repairDone') : r.message || ''))}
                    >
                      {t('inst.repair')}
                    </button>
                    <button className="btn danger" onClick={() => void removeProject()}>
                      {t('inst.deleteVersion')}
                    </button>
                  </div>
                </div>

                <div className="inst-actions">
                  <button className="btn primary" onClick={() => void save()}>
                    {t('common.save')}
                  </button>
                </div>
                {msg && <div className="dim" style={{ fontSize: 11.5, textAlign: 'center' }}>{msg}</div>}
              </>
            )}

            {tab === 'settings' && (
              <>
                <div className="hint-banner">{t('inst.scopeHint')}</div>
                <div className="inst-card">
                  <h3>{t('inst.launchOptions')}</h3>
                  <div className="form-row">
                    <label>{t('inst.isolation')}</label>
                    <button className="btn sm" onClick={() => setIsolated(!isolated)}>
                      {isolated ? t('instance.enabled') : t('instance.disabled')}
                    </button>
                  </div>
                  <div className="form-row">
                    <label>{t('inst.windowTitle')}</label>
                    <input className="input" placeholder={t('inst.followGlobal')} value={windowTitle} onChange={(e) => setWindowTitle(e.target.value)} />
                  </div>
                  <div className="form-row">
                    <label>Java</label>
                    <input className="input mono" placeholder={state.settings.javaPath || t('inst.javaAuto')} value={java} onChange={(e) => setJava(e.target.value)} />
                  </div>
                  <div className="form-row">
                    <label>{t('instance.width')} / {t('instance.height')}</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input className="input" style={{ width: 110 }} value={width} placeholder="854" onChange={(e) => setWidth(e.target.value)} />
                      <input className="input" style={{ width: 110 }} value={height} placeholder="480" onChange={(e) => setHeight(e.target.value)} />
                    </div>
                  </div>
                </div>

                <div className="inst-card">
                  <h3>{t('inst.memory')}</h3>
                  <div className="form-row">
                    <label>{t('inst.memoryMode')}</label>
                    <div className="filters">
                      {(
                        [
                          ['inst.followGlobal', 'global'],
                          ['inst.autoConfig', 'auto'],
                          ['inst.custom', 'custom']
                        ] as [string, 'global' | 'auto' | 'custom'][]
                      ).map(([key, mode]) => (
                        <button key={mode} className={'subtab' + (memoryMode === mode ? ' active' : '')} onClick={() => setMemoryMode(mode)}>
                          {t(key)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {memoryMode === 'custom' && (
                    <div className="form-row">
                      <label>{t('settings.memory')}</label>
                      <input className="input" value={memoryMb} onChange={(e) => setMemoryMb(e.target.value)} />
                    </div>
                  )}
                  <div className="form-row">
                    <label>{t('inst.alloc')}</label>
                    <div>
                      <div className="bar" style={{ marginBottom: 6 }}>
                        <i style={{ width: `${memPct}%` }} />
                      </div>
                      <span className="dim" style={{ fontSize: 11.5 }}>
                        {autoMem / 1024 >= 1 ? (autoMem / 1024).toFixed(1) + ' GB' : autoMem + ' MB'} / {(mem.totalMb / 1024).toFixed(1)} GB
                      </span>
                    </div>
                  </div>
                </div>

                <div className="inst-card">
                  <h3>{t('inst.server')}</h3>
                  <div className="form-row">
                    <label>{t('inst.joinServer')}</label>
                    <input className="input mono" placeholder="play.example.com" value={joinServer} onChange={(e) => setJoinServer(e.target.value)} />
                  </div>
                </div>

                <div className="inst-actions">
                  <button className="btn" onClick={onGoSettings}>
                    <IconGear /> {t('inst.globalSettings')}
                  </button>
                  <button className="btn primary" onClick={() => void save()}>
                    {t('common.save')}
                  </button>
                </div>
                {msg && <div className="dim" style={{ fontSize: 11.5, textAlign: 'center' }}>{msg}</div>}
              </>
            )}

            {tab === 'modify' && (
              <>
                <div className="hint-banner">{t('inst.modifyHint')}</div>
                <div className="inst-card">
                  <h3>{t('inst.loaders')}</h3>
                  {[
                    { id: 'forge', label: 'Forge', compat: project.loader === 'forge' || project.loader === 'vanilla' },
                    { id: 'neoforge', label: 'NeoForge', compat: project.loader === 'neoforge' || project.loader === 'vanilla' },
                    { id: 'fabric', label: 'Fabric', compat: project.loader === 'fabric' || project.loader === 'vanilla' },
                    { id: 'quilt', label: 'Quilt', compat: project.loader === 'quilt' || project.loader === 'vanilla' }
                  ].map((l) => {
                    const current = project.loader === l.id
                    return (
                      <div className="form-row" key={l.id}>
                        <label>{l.label}</label>
                        <div className="row-between">
                          <span className="dim" style={{ fontSize: 12 }}>
                            {current
                              ? `${project.loaderVersion ?? ''}（${t('projects.current')}）`
                              : l.compat
                                ? t('inst.canSwitch')
                                : t('inst.incompatibleWith') + ' ' + project.loader}
                          </span>
                          <button
                            className="btn sm"
                            disabled={!l.compat || current}
                            onClick={() => void window.api.loader.install(l.id as never, project.mcVersion, '', project.name)}
                          >
                            {t('inst.switch')}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {tab === 'mods' && (
              <>
                <div className="inst-card">
                  <div className="filters" style={{ marginBottom: 10 }}>
                    <input
                      className="input"
                      style={{ height: 32, flex: 1 }}
                      placeholder={t('inst.searchMods')}
                      value={modQuery}
                      onChange={(e) => setModQuery(e.target.value)}
                    />
                    <button className="btn sm" onClick={() => void window.api.instance.openModsDir(project.id)}>
                      <IconFolder /> {t('inst.openFolder')}
                    </button>
                    <button
                      className="btn sm"
                      onClick={() => void window.api.mods.fromFile(project.id).then((r) => r.ok && setMods(r.mods ?? []))}
                    >
                      {t('inst.fromFile')}
                    </button>
                    <button className="btn sm" onClick={onGoDownload}>
                      {t('inst.downloadNew')}
                    </button>
                  </div>
                  <div className="filters" style={{ marginBottom: 10 }}>
                    <button className="btn sm" onClick={() => setShowPicker(true)}>`r`n            + {t('library.addToProject')}`r`n          </button>`r`n          <button className="btn sm" onClick={() => void window.api.mods.bulk(project.id, true).then((r) => setMods(r.mods))}>
                      {t('inst.enableAll')}
                    </button>
                    <button className="btn sm" onClick={() => void window.api.mods.bulk(project.id, false).then((r) => setMods(r.mods))}>
                      {t('inst.disableAll')}
                    </button>
                    <span className="dim" style={{ fontSize: 11.5 }}>
                      {t('inst.all')} ({mods.length}) · {t('instance.enabled')} ({enabled})
                    </span>
                  </div>
                  <div className="vlist" style={{ maxHeight: 330, overflowY: 'auto' }}>
                    {shownMods.length === 0 && <div className="empty" style={{ border: 0 }}>{t('instance.noMods')}</div>}
                    {shownMods.map((m) => (
                      <div className="vrow" key={m.fileName}>
                        <div className="inst-icon" style={{ width: 26, height: 26, flex: '0 0 26px', fontSize: 11 }}>
                          {(m.fileName[0] || '?').toUpperCase()}
                        </div>
                        <span className="vid" style={{ minWidth: 0, flex: 1, fontSize: 12.5 }}>
                          {m.fileName}
                        </span>
                        <span className={m.enabled ? 'tag ok' : 'tag'}>{m.enabled ? t('instance.enabled') : t('instance.disabled')}</span>
                        <span className="vmeta">{(m.size / 1024 / 1024).toFixed(1)} MB</span>
                        <button className="btn sm" onClick={() => void window.api.instance.toggleMod(project.id, m.fileName).then((r) => setMods(r.mods))}>
                          {m.enabled ? t('instance.disable') : t('instance.enable')}
                        </button>
                        <button className="btn sm" onClick={() => void window.api.instance.deleteMod(project.id, m.fileName).then((r) => setMods(r.mods))}>
                          {t('common.delete')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {tab === 'export' && (
              <>
                <div className="hint-banner">{t('inst.exportHint')}</div>
                <div className="inst-card">
                  <h3>{t('inst.export')}</h3>
                  <div className="form-row">
                    <label>{t('inst.packName')}</label>
                    <input className="input" value={exportName} onChange={(e) => setExportName(e.target.value)} />
                  </div>
                  <div className="form-row">
                    <label>{t('inst.packVersion')}</label>
                    <input className="input" value={packVersion} onChange={(e) => setPackVersion(e.target.value)} />
                  </div>
                  <div className="form-row">
                    <label>{t('inst.contents')}</label>
                    <span className="dim" style={{ fontSize: 12 }}>
                      {t('home.mods')} {mods.length} · {t('inst.saves')} {saves.length} · config · options.txt
                    </span>
                  </div>
                </div>
                <div className="inst-actions">
                  <button className="btn primary" onClick={() => void doExport()}>
                    <IconDownload /> {t('inst.startExport')}
                  </button>
                </div>
                {msg && <div className="dim" style={{ fontSize: 11.5, textAlign: 'center' }}>{msg}</div>}
              </>
            )}
          </div>
        </div>
      </div>
      {showPicker && (
        <LibraryPicker
          projectId={project.id}
          projectLoader={project.loader}
          projectMc={project.mcVersion}
          onClose={() => setShowPicker(false)}
          onDone={() =>
            void window.api.mods.list(project.id).then((r) => setMods((r.entries as never) || []))
          }
        />
      )}
    </div>
  )
}
