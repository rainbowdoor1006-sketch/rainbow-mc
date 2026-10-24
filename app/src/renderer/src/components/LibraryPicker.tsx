import React, { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'

interface Lib {
  id: string
  title: string
  kind: string
  versionNumber: string
  fileName: string
  loaders: string[]
  gameVersions: string[]
}

/**
 * 从组件库往项目里添加组件（复制文件，不重新下载）。
 */
export function LibraryPicker({
  projectId,
  projectLoader,
  projectMc,
  onClose,
  onDone
}: {
  projectId: string
  projectLoader: string
  projectMc: string
  onClose: () => void
  onDone: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [list, setList] = useState<Lib[]>([])
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [already, setAlready] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [kind, setKind] = useState('mod')

  useEffect(() => {
    void (async () => {
      const all = (await window.api.library.list()) as Lib[]
      setList(all)
      setAlready(await window.api.library.projectState(projectId))
    })()
  }, [projectId])

  const shown = list.filter((x) => x.kind === kind)
  const compatible = (x: Lib): boolean =>
    (projectLoader === 'vanilla' || x.loaders.includes(projectLoader)) &&
    (x.gameVersions.length === 0 || x.gameVersions.includes(projectMc))

  const apply = async (): Promise<void> => {
    const ids = Object.keys(picked).filter((id) => picked[id])
    if (!ids.length) return
    setBusy(true)
    const r = await window.api.library.apply(ids, projectId)
    setBusy(false)
    if (!r.ok) {
      setMsg(r.message || '复制失败')
      return
    }
    setMsg(`${t('library.added')}：${r.copied.join('、')}`)
    setAlready(await window.api.library.projectState(projectId))
    setPicked({})
    onDone()
  }

  return (
    <div className="overlay" style={{ zIndex: 210 }}>
      <div className="modal" style={{ width: 700, maxHeight: 'calc(100vh - 90px)', display: 'flex', flexDirection: 'column' }}>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{t('library.pickTitle')}</h2>
          <button className="win-btn" style={{ width: 26, height: 26 }} onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="dim" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 10 }}>
          {t('library.pickHint')}
        </p>

        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          {[
            ['mod', t('resources.mods')],
            ['shader', t('resources.shaders')],
            ['resourcepack', t('resources.resourcepacks')]
          ].map(([k, label]) => (
            <button key={k} className={'mat-btn' + (kind === k ? ' active' : '')} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>

        <div className="detail-list" style={{ flex: 1 }}>
          {!shown.length && <div className="empty">{t('library.empty')}</div>}
          {shown.map((x) => {
            const used = already[x.id]
            const ok = compatible(x)
            return (
              <label key={x.id} className={'detail-row' + (used ? ' used' : '')}>
                <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    disabled={used}
                    checked={!!picked[x.id]}
                    onChange={(e) => setPicked((p) => ({ ...p, [x.id]: e.target.checked }))}
                  />
                  <span>
                    <span className="detail-row-title">{x.title}</span>
                    <span className="detail-row-meta">
                      {x.versionNumber} · {x.loaders.join('/') || 'vanilla'} · {x.gameVersions.slice(0, 2).join(',')}
                    </span>
                  </span>
                </span>
                <span className={'tag' + (used ? ' ok' : ok ? '' : ' warn')}>
                  {used ? t('library.inProject') : ok ? t('library.compatible') : t('library.mismatch')}
                </span>
              </label>
            )
          })}
        </div>

        {msg && <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>{msg}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            className="btn primary"
            disabled={busy || !Object.values(picked).some(Boolean)}
            onClick={() => void apply()}
          >
            {t('library.addToProject')}
          </button>
        </div>
      </div>
    </div>
  )
}
