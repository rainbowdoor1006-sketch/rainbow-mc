import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/i18n'

/**
 * 头像裁剪器：强制 1:1 正方形，输出 512x512 PNG。
 * 拖动移动、滑块缩放，效果与背景裁剪器一致。
 */
export function AvatarCrop({
  dataUrl,
  onCancel,
  onDone
}: {
  dataUrl: string
  onCancel: () => void
  onDone: (cropped: string) => void
}): React.ReactElement {
  const { t } = useI18n()
  const imgRef = useRef<HTMLImageElement>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const BOX = 320 // 1:1

  const clamp = (z: number, ox: number, oy: number): { x: number; y: number } => {
    const img = imgRef.current
    if (!img || !img.naturalWidth) return { x: ox, y: oy }
    const scale = Math.max(BOX / img.naturalWidth, BOX / img.naturalHeight) * z
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    const maxX = Math.max(0, (w - BOX) / 2)
    const maxY = Math.max(0, (h - BOX) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, ox)), y: Math.max(-maxY, Math.min(maxY, oy)) }
  }

  useEffect(() => {
    setOffset((o) => clamp(zoom, o.x, o.y))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  useEffect(() => {
    const move = (e: MouseEvent): void => {
      const d = dragRef.current
      if (!d) return
      setOffset(clamp(zoom, d.ox + (e.clientX - d.sx), d.oy + (e.clientY - d.sy)))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  const confirm = (): void => {
    const img = imgRef.current
    if (!img) return
    const OUT = 512
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scale = Math.max(BOX / img.naturalWidth, BOX / img.naturalHeight) * zoom
    const ratio = OUT / BOX
    const drawW = img.naturalWidth * scale * ratio
    const drawH = img.naturalHeight * scale * ratio
    const dx = (OUT - drawW) / 2 + offset.x * ratio
    const dy = (OUT - drawH) / 2 + offset.y * ratio
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, OUT, OUT)
    ctx.drawImage(img, dx, dy, drawW, drawH)
    onDone(canvas.toDataURL('image/png'))
  }

  const scale =
    imgRef.current && loaded
      ? Math.max(BOX / imgRef.current.naturalWidth, BOX / imgRef.current.naturalHeight) * zoom
      : 1

  return createPortal(
    <div className="overlay" style={{ zIndex: 220 }}>
      <div className="modal" style={{ width: 460 }}>
        <h2 style={{ fontSize: 16 }}>{t('avatar.cropTitle')}</h2>
        <p className="dim" style={{ fontSize: 12.5, margin: '8px 0 14px', lineHeight: 1.7 }}>
          {t('avatar.cropHint')}
        </p>

        <div
          className="crop-box"
          style={{ width: BOX, height: BOX, borderRadius: 999 }}
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
          <button
            className="btn"
            onClick={() => {
              setZoom(1)
              setOffset({ x: 0, y: 0 })
            }}
          >
            {t('appearance.resetView')}
          </button>
          <button className="btn primary" onClick={confirm} disabled={!loaded}>
            {t('avatar.useIt')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
