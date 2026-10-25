import React, { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'

interface Task {
  id: string
  label: string
  kind: string
  pct: number
  speed: number
  loaded: number
  total: number
}

/**
 * 右下角圆形下载进度：不显示百分比，靠环形填充表示进度；点击展开详情。
 */
export function DownloadOrb(): React.ReactElement | null {
  const { t } = useI18n()
  const [tasks, setTasks] = useState<Task[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api.downloads.snapshot().then((list) => {
      if (alive) setTasks(list as Task[])
    })
    const off = window.api.downloads.onTasks((list) => setTasks(list as Task[]))
    return () => {
      alive = false
      off()
    }
  }, [])

  if (!tasks.length) return null

  const avg = Math.round(tasks.reduce((s, x) => s + x.pct, 0) / tasks.length)
  const totalSpeed = tasks.reduce((s, x) => s + x.speed, 0)

  const R = 22
  const C = 2 * Math.PI * R

  return (
    <div className="dl-orb-wrap">
      {open && (
        <div className="dl-orb-panel">
          <div className="dl-orb-head">
            <span>{t('downloads.title')}</span>
            <button className="win-btn" style={{ width: 22, height: 22 }} onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          {tasks.map((x) => (
            <div key={x.id} className="dl-orb-row">
              <div className="dl-orb-name" title={x.label}>
                {x.label}
              </div>
              <div className="dl-orb-meta">
                <span className="mono">{x.pct}%</span>
                <span className="mono dim">{fmtSpeed(x.speed)}</span>
              </div>
              <div className="dl-orb-bar">
                <div style={{ width: `${x.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        className={'dl-orb' + (open ? ' open' : '')}
        onClick={() => setOpen((v) => !v)}
        title={t('downloads.title')}
      >
        <svg width="56" height="56" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r={R} className="dl-orb-track" />
          <circle
            cx="28"
            cy="28"
            r={R}
            className="dl-orb-fill"
            strokeDasharray={`${(C * avg) / 100} ${C}`}
            transform="rotate(-90 28 28)"
          />
        </svg>
        <span className="dl-orb-icon">↓</span>
        {totalSpeed > 0 && <span className="dl-orb-speed">{fmtSpeed(totalSpeed)}</span>}
      </button>
    </div>
  )
}

function fmtSpeed(bps: number): string {
  if (!bps || bps < 1024) return '—'
  const kb = bps / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB/s`
  return `${(kb / 1024).toFixed(1)} MB/s`
}
