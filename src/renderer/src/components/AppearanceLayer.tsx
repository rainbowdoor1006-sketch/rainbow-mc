import React, { useEffect, useState } from 'react'
import type { AppearanceSettings } from '@shared/types'
import { OFFICIAL_PRESET } from '@/assets/preset-official'

/**
 * 外观层：把材质、主色、自定义背景应用到整个界面。
 * - data-material 挂在 <html> 上，CSS 按材质切换配色
 * - --accent 覆盖主色
 * - 背景图走自定义协议 rainbow://，dev/prod 都能加载
 */
export function AppearanceLayer({ appearance }: { appearance?: AppearanceSettings }): React.ReactElement | null {
  const [url, setUrl] = useState('')

  const material = appearance?.material || 'dark'
  const accent = appearance?.accent || '#7fb69b'
  const dim = appearance?.backgroundDim ?? 45
  const file = appearance?.backgroundFile || ''
  const mode = appearance?.backgroundMode || (file ? 'image' : 'default')

  useEffect(() => {
    document.documentElement.dataset.material = material
    document.documentElement.style.setProperty('--accent', accent)
    // 主色衍生变量
    document.documentElement.style.setProperty('--accent-soft', hexToRgba(accent, 0.12))
    document.documentElement.style.setProperty('--accent-deep', shade(accent, -0.18))
  }, [material, accent])

  useEffect(() => {
    if (mode === 'preset') {
      setUrl(OFFICIAL_PRESET)
      return
    }
    if (mode === 'image' && file) {
      setUrl('rainbow://local/' + encodeURIComponent(file))
      return
    }
    setUrl('')
  }, [mode, file])

  if (!url) return null

  return (
    <div className="app-bg" aria-hidden>
      <div className="app-bg-img" style={{ backgroundImage: `url("${url}")` }} />
      <div className="app-bg-dim" style={{ background: `rgba(0,0,0,${Math.max(0, Math.min(80, dim)) / 100})` }} />
    </div>
  )
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full || '7fb69b', 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full || '7fb69b', 16)
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))
  const r = clamp(((n >> 16) & 255) * (1 + amount))
  const g = clamp(((n >> 8) & 255) * (1 + amount))
  const b = clamp((n & 255) * (1 + amount))
  return (
    '#' +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  )
}
