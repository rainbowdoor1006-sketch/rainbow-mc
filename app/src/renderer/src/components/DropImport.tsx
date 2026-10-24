import React, { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'

type Stage = 'analyze' | 'extract' | 'download' | 'loader'

/**
 * 拖拽整合包 / ZIP 进窗口：自动解压分析并单独建项目。
 * 导入过程中显示进度弹窗；点 ✕ 会二次确认（确认=终止安装，不了=继续）。
 */
export function DropImport({ onImported }: { onImported: () => void }): React.ReactElement | null {
  const { t } = useI18n()
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState<{ path: string; base: string } | null>(null)
  const [name, setName] = useState('')
  const [taken, setTaken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 进度
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState<Stage>('analyze')
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [confirmClose, setConfirmClose] = useState(false)
  const [fileName, setFileName] = useState('')
  const [speed, setSpeed] = useState(0)
  const lastRef = React.useRef<{ t: number; d: number }>({ t: 0, d: 0 })

  useEffect(() => {
    const off = window.api.pack.onProgress((p) => {
      setStage(p.stage as Stage)
      setDone(p.done)
      setTotal(p.total)
      if (p.name) setFileName(p.name)
      const now = Date.now()
      const l = lastRef.current
      if (l.t && now - l.t > 300) {
        setSpeed(Math.max(0, ((p.done - l.d) * 1000) / (now - l.t)))
        lastRef.current = { t: now, d: p.done }
      } else if (!l.t) {
        lastRef.current = { t: now, d: p.done }
      }
    })
    return off
  }, [])

  useEffect(() => {
    const onOver = (e: DragEvent): void => {
      if (!e.dataTransfer?.types?.includes('Files')) return
      e.preventDefault()
      if (!running) setDragging(true)
    }
    const onLeave = (e: DragEvent): void => {
      if (e.relatedTarget) return
      setDragging(false)
    }
    // 真实路径由 preload 用 webUtils.getPathForFile 取出来，再以事件形式抛给界面
    const onFileDrop = (ev: Event): void => {
      setDragging(false)
      if (running) return
      const detail = (ev as CustomEvent<{ path: string; name: string }>).detail
      if (!detail?.path) {
        setError(t('drop.noPath'))
        return
      }
      const base = (detail.name || '整合包').replace(/\.(zip|jar|mrpack)$/i, '')
      setPending({ path: detail.path, base })
      setName(base)
      setError('')
      void window.api.pack.nameTaken(base).then((v) => setTaken(v))
    }

    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('rainbow:file-drop', onFileDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('rainbow:file-drop', onFileDrop)
    }
  }, [running])

  const start = async (): Promise<void> => {
    const n = name.trim()
    if (!n || !pending) return
    if (await window.api.pack.nameTaken(n)) {
      setTaken(true)
      return
    }
    setPending(null)
    setError('')
    setRunning(true)
    setConfirmClose(false)
    setStage('analyze')
    setDone(0)
    setTotal(0)
    const r = await window.api.pack.importPath(pending.path, n)
    setRunning(false)
    if (!r.ok) {
      setError(r.message || '导入失败')
      return
    }
    onImported()
  }

  const closeRunning = async (): Promise<void> => {
    await window.api.pack.cancel()
    setConfirmClose(false)
    setRunning(false)
    setError(t('drop.cancelled'))
  }

  // 拖拽遮罩
  if (dragging) {
    return (
      <div className="drop-mask">
        <div className="drop-card">
          <div style={{ fontSize: 34 }}>⤓</div>
          <div style={{ fontSize: 14, fontWeight: 620 }}>{t('drop.title')}</div>
          <div className="dim" style={{ fontSize: 12 }}>
            {t('drop.hint')}
          </div>
        </div>
      </div>
    )
  }

  // 进度界面（全屏）
  if (running) {
    const indeterminate = stage === 'analyze' || stage === 'loader'
    const pct = !indeterminate && total > 0 ? Math.min(100, (done / total) * 100) : 0
    const stageText =
      stage === 'analyze'
        ? t('drop.stageAnalyze')
        : stage === 'extract'
          ? t('drop.stageExtract')
          : stage === 'loader'
            ? t('drop.stageLoader')
            : t('drop.stageDownload')
    const fmt = (n: number): string => {
      if (!n || n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }
    return (
      <div className="parse-full">
        <div className="parse-head">
          <div className="parse-head-drag" />
          <span className="parse-title">{t('drop.installing')}</span>
          <div className="parse-win">
            <button className="win-btn" onClick={() => void window.api.win.minimize()}>
              &#8211;
            </button>
            <button className="win-btn" onClick={() => void window.api.win.toggleMaximize()}>
              &#9633;
            </button>
            <button className="win-btn close" onClick={() => setConfirmClose(true)}>
              &#10005;
            </button>
          </div>
        </div>

        {!confirmClose ? (
          <div className="parse-body">
            <div className="parse-stage">{stageText}</div>
            <div className="parse-file mono">{fileName || '…'}</div>
            <div className={'parse-bar' + (indeterminate ? ' indeterminate' : '')}>
              <div style={{ width: indeterminate ? '40%' : `${pct}%` }} />
            </div>
            <div className="parse-stats">
              <span className="mono">{indeterminate ? '…' : pct.toFixed(1) + '%'}</span>
              <span className="mono dim">
                {indeterminate ? t('drop.working') : `${fmt(done)} / ${fmt(total)}`}
              </span>
              <span className="mono dim">{fmt(speed)}/s</span>
            </div>
            <button className="btn" style={{ marginTop: 26 }} onClick={() => setConfirmClose(true)}>
              {t('drop.stop')}
            </button>
          </div>
        ) : (
          <div className="parse-body">
            <div className="parse-stage" style={{ fontSize: 20 }}>
              {t('drop.closeConfirmTitle')}
            </div>
            <p className="dim" style={{ fontSize: 13, lineHeight: 1.9, maxWidth: 520, textAlign: 'center' }}>
              {t('drop.closeConfirm')}
            </p>
            <div className="row" style={{ gap: 12, marginTop: 18 }}>
              <button className="btn" onClick={() => setConfirmClose(false)}>
                {t('drop.noKeepGoing')}
              </button>
              <button className="btn primary" onClick={() => void closeRunning()}>
                {t('drop.yesAbort')}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }
  // 命名弹窗
  if (!pending) {
    return error ? (
      <div className="overlay" style={{ zIndex: 220 }}>
        <div className="modal" style={{ width: 460 }}>
          <h2 style={{ fontSize: 16 }}>{t('drop.installing')}</h2>
          <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.8, margin: '10px 0 14px' }}>
            {error}
          </p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => setError('')}>
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    ) : null
  }

  return (
    <div className="overlay" style={{ zIndex: 220 }}>
      <div className="modal" style={{ width: 520 }}>
        <h2 style={{ fontSize: 16 }}>{t('drop.createTitle')}</h2>
        <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.8, margin: '10px 0 14px' }}>
          {t('drop.createHint')}
        </p>
        <div className="field">
          <label>{t('home.projectName')}</label>
          <input
            className="input"
            value={name}
            autoFocus
            onChange={(e) => {
              setName(e.target.value)
              setTaken(false)
              void window.api.pack.nameTaken(e.target.value.trim()).then(setTaken)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !taken) void start()
            }}
          />
          {taken && (
            <span className="hint" style={{ color: 'var(--err)' }}>
              {t('drop.nameTaken')}
            </span>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => setPending(null)}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={taken || !name.trim()} onClick={() => void start()}>
            {t('drop.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
