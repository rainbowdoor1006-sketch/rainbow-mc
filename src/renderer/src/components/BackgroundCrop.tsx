import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/i18n'

/**
 * 背景裁剪器：用户必须先放大/移动，把图调到位后再确认。
 * 输出固定 16:10（跟启动器窗口比例接近），1920x1200，JPEG 质量 0.9。
 */
export function BackgroundCrop({
  dataUrl,
  onCancel,
  onDone
}: {
  dataUrl: string
  onCancel: () => void
  onDone: (cropped: string) => void
}): React.ReactElement {
  const { t } = useI18n()
  const boxRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const BOX_W = 760
  const BOX_H = 475 // 16:10

  const clampOffset = useCallback(
    (z: number, ox: number, oy: number) => {
      const img = imgRef.current
      if (!img || !img.naturalWidth) return { x: ox, y: oy }
      const scale = Math.max(BOX_W / img.naturalWidth, BOX_H / img.naturalHeight) * z
      const w = img.naturalWidth * scale
      const h = img.naturalHeight * scale
      const maxX = Math.max(0, (w - BOX_W) / 2)
      const maxY = Math.max(0, (h - BOX_H) / 2)
      return { x: Math.max(-maxX, Math.min(maxX, ox)), y: Math.max(-maxY, Math.min(maxY, oy)) }
    },
    [BOX_W, BOX_H]
  )

  useEffect(() => {
    setOffset((o) => clampOffset(zoom, o.x, o.y))
  }, [zoom, clampOffset])

  useEffect(() => {
    const move = (e: MouseEvent): void => {
      const d = dragRef.current
      if (!d) return
      setOffset(clampOffset(zoom, d.ox + (e.clientX - d.sx), d.oy + (e.clientY - d.sy)))
    }
    const up = (): void => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [zoom, clampOffset])

  const confirm = (): void => {
    const img = imgRef.current
    if (!img) return
    const outW = 1920
    const outH = 1200
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scale = Math.max(BOX_W / img.naturalWidth, BOX_H / img.naturalHeight) * zoom
    const ratio = outW / BOX_W
    const drawW = img.naturalWidth * scale * ratio
    const drawH = img.naturalHeight * scale * ratio
    const dx = (outW - drawW) / 2 + offset.x * ratio
    const dy = (outH - drawH) / 2 + offset.y * ratio
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, outW, outH)
    ctx.drawImage(img, dx, dy, drawW, drawH)
    onDone(canvas.toDataURL('image/jpeg', 0.9))
  }

  const scale = imgRef.current && loaded
    ? Math.max(BOX_W / imgRef.current.naturalWidth, BOX_H / imgRef.current.naturalHeight) * zoom
    : 1

  return createPortal(
    <div className="overlay" style={{ zIndex: 210 }}>
      <div className="modal" style={{ width: 840 }}>
        <h2 style={{ fontSize: 16 }}>{t('appearance.cropTitle')}</h2>
        <p className="dim" style={{ fontSize: 12.5, margin: '8px 0 14px', lineHeight: 1.7 }}>
          {t('appearance.cropHint')}
        </p>

        <div
          ref={boxRef}
          className="crop-box"
          style={{ width: BOX_W, height: BOX_H }}
          onMouseDown={(e) => {
            dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y }
          }}
        >
          <img
            ref={imgRef}
            src={dataUrl}
            alt=""
            draggable={false}
            onLoad={() => setLoaded(true)}
            style={{
              width: imgRef.current ? imgRef.current.naturalWidth * scale : 'auto',
              height: imgRef.current ? imgRef.current.naturalHeight * scale : 'auto',
              transform: `translate(${offset.x}px, ${offset.y}px)`,
              opacity: loaded ? 1 : 0
            }}
          />
          <div className="crop-grid" />
        </div>

        <div className="row-between" style={{ marginTop: 16, gap: 14 }}>
          <span className="dim" style={{ fontSize: 12 }}>
            {t('appearance.zoom')}
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#7fb69b' }}
          />
          <span className="mono dim" style={{ fontSize: 12, width: 46, textAlign: 'right' }}>
            {zoom.toFixed(2)}x
          </span>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className="btn" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }) }}>
            {t('appearance.resetView')}
          </button>
          <button className="btn primary" onClick={confirm} disabled={!loaded}>
            {t('appearance.useIt')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
