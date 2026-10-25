import React, { useEffect, useRef, useState } from 'react'
import { PEACE_QUOTES } from '@/data/quotes'

/**
 * 启动页上方的和平名言轮播。
 *
 * 交互：
 *   · 每 8 秒切换一条，淡入淡出
 *   · 鼠标悬停 → 暂停轮播
 *   · 左键 → 下一条；右键 → 上一条（拦截右键菜单）
 *   · 只显示中文译文 + 「—— 说话人 · 年份」
 */
export function QuoteBar(): React.ReactElement {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * PEACE_QUOTES.length))
  const [fade, setFade] = useState(true)
  const pausedRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  const total = PEACE_QUOTES.length

  const go = (delta: number): void => {
    setFade(false)
    window.setTimeout(() => {
      setIndex((i) => (i + delta + total) % total)
      setFade(true)
    }, 180)
  }

  useEffect(() => {
    timerRef.current = window.setInterval(() => {
      if (pausedRef.current) return
      go(1)
    }, 8000)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const q = PEACE_QUOTES[index]

  return (
    <div
      className="quote-bar"
      title="左键下一条 · 右键上一条 · 悬停暂停"
      onMouseEnter={() => {
        pausedRef.current = true
      }}
      onMouseLeave={() => {
        pausedRef.current = false
      }}
      onClick={() => go(1)}
      onContextMenu={(e) => {
        e.preventDefault()
        go(-1)
      }}
      style={{
        cursor: 'pointer',
        userSelect: 'none',
        marginBottom: 12,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--line)',
        background: 'rgba(255,255,255,.02)',
        minHeight: 62,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 4,
        transition: 'opacity .18s ease',
        opacity: fade ? 1 : 0
      }}
    >
      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--txt)' }}>{q.zh}</div>
      <div style={{ fontSize: 11.5, color: 'var(--dim)' }}>
        —— {q.by} · {q.year}
      </div>
    </div>
  )
}
