import React, { useEffect, useRef, useState } from 'react'

/**
 * 主控台（Ctrl+K）：像 PowerShell 一样操作启动器。
 * 输出支持文本 / 键值 / 表格 / 条形图，Enter 执行，↑↓ 历史，Tab 补全。
 */

type OutLine =
  | { kind: 'text'; text: string }
  | { kind: 'dim'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'warn'; text: string }
  | { kind: 'err'; text: string }
  | { kind: 'kv'; pairs: [string, string][] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'bar'; items: { label: string; value: number; unit?: string }[] }

interface Entry {
  input?: string
  lines: OutLine[]
}

const COLOR: Record<string, string> = {
  text: 'var(--txt)',
  dim: 'var(--dim)',
  ok: 'var(--jade)',
  warn: 'var(--warn)',
  err: 'var(--err)'
}

function Line({ l }: { l: OutLine }): React.ReactElement {
  if (l.kind === 'kv') {
    return (
      <div style={{ margin: '2px 0' }}>
        {l.pairs.map(([k, v], i) => (
          <div key={i} style={{ display: 'flex', gap: 12 }}>
            <span style={{ color: 'var(--dim)', minWidth: 150 }}>{k}</span>
            <span style={{ color: 'var(--txt)', wordBreak: 'break-all' }}>{v}</span>
          </div>
        ))}
      </div>
    )
  }
  if (l.kind === 'table') {
    return (
      <table style={{ borderCollapse: 'collapse', margin: '6px 0', fontSize: 12 }}>
        <thead>
          <tr>
            {l.head.map((h, i) => (
              <th key={i} style={{ textAlign: 'left', padding: '3px 12px 3px 0', color: 'var(--dim)', fontWeight: 500 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {l.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} style={{ padding: '3px 12px 3px 0', borderTop: '1px solid var(--line)' }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (l.kind === 'bar') {
    const max = Math.max(...l.items.map((i) => i.value), 1)
    return (
      <div style={{ margin: '6px 0' }}>
        {l.items.map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0' }}>
            <span style={{ width: 90, fontSize: 11.5, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.label}
            </span>
            <div style={{ flex: 1, height: 8, background: '#1b2124', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(2, (it.value / max) * 100)}%`,
                  height: '100%',
                  background: 'var(--jade)',
                  opacity: 0.75
                }}
              />
            </div>
            <span style={{ width: 76, textAlign: 'right', fontSize: 11.5, color: 'var(--dim)' }}>
              {it.value.toFixed(it.value >= 100 ? 0 : 1)} {it.unit ?? ''}
            </span>
          </div>
        ))}
      </div>
    )
  }
  return <div style={{ color: COLOR[l.kind] ?? 'var(--txt)', whiteSpace: 'pre-wrap' }}>{l.text}</div>
}

export function ConsolePanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const [entries, setEntries] = useState<Entry[]>([
    {
      lines: [
        { kind: 'text', text: 'RAINBOW MC 主控台' },
        { kind: 'dim', text: '输入 help 看全部命令；↑↓ 翻历史，Tab 补全，Esc 关闭' }
      ]
    }
  ])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [hIdx, setHIdx] = useState(-1)
  const [cmds, setCmds] = useState<{ name: string; group: string; usage: string; desc: string }[]>([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.console.list().then(setCmds)
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [entries])

  const suggestions = input.trim()
    ? cmds.filter((c) => c.name.startsWith(input.trim()) && c.name !== input.trim()).slice(0, 6)
    : []

  const exec = async (raw: string): Promise<void> => {
    const cmd = raw.trim()
    if (!cmd) return
    setHistory((h) => [...h, cmd])
    setHIdx(-1)
    setInput('')
    if (cmd === 'clear' || cmd === 'cls') {
      setEntries([])
      return
    }
    setBusy(true)
    setEntries((e) => [...e, { input: cmd, lines: [] }])
    const r = await window.api.console.run(cmd)
    setBusy(false)
    setEntries((e) => {
      const next = [...e]
      next[next.length - 1] = { input: cmd, lines: (r.lines as OutLine[]) ?? [] }
      return next
    })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 820, maxWidth: '94vw', height: '72vh', display: 'flex', flexDirection: 'column', padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>主控台</div>
          <div style={{ marginLeft: 10, fontSize: 11.5, color: 'var(--dim)' }}>Ctrl+K 打开 · Esc 关闭</div>
          <div style={{ flex: 1 }} />
          <button className="btn sm" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="mono" style={{ flex: 1, overflowY: 'auto', padding: '10px 16px', fontSize: 12.5, lineHeight: 1.65 }}>
          {entries.map((en, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              {en.input && (
                <div style={{ color: 'var(--jade)' }}>
                  <span style={{ color: 'var(--dim)' }}>{'> '}</span>
                  {en.input}
                </div>
              )}
              {en.lines.map((l, j) => (
                <Line key={j} l={l} />
              ))}
            </div>
          ))}
          {busy && <div style={{ color: 'var(--dim)' }}>执行中…</div>}
          <div ref={bottomRef} />
        </div>

        {suggestions.length > 0 && (
          <div style={{ padding: '4px 16px', borderTop: '1px solid var(--line)', fontSize: 11.5, color: 'var(--dim)' }}>
            {suggestions.map((s) => (
              <span
                key={s.name}
                style={{ marginRight: 12, cursor: 'pointer' }}
                onClick={() => {
                  setInput(s.name)
                  inputRef.current?.focus()
                }}
              >
                {s.name}
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
          <span style={{ color: 'var(--jade)', fontFamily: 'monospace' }}>&gt;</span>
          <input
            ref={inputRef}
            className="input"
            style={{ flex: 1, fontFamily: 'monospace' }}
            value={input}
            placeholder="输入命令，例如 help / project.list / config.list / mirror.test"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void exec(input)
              else if (e.key === 'Tab') {
                e.preventDefault()
                const hit = suggestions[0]
                if (hit) setInput(hit.name)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                if (!history.length) return
                const idx = hIdx < 0 ? history.length - 1 : Math.max(0, hIdx - 1)
                setHIdx(idx)
                setInput(history[idx])
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (hIdx < 0) return
                const idx = hIdx + 1
                if (idx >= history.length) {
                  setHIdx(-1)
                  setInput('')
                } else {
                  setHIdx(idx)
                  setInput(history[idx])
                }
              } else if (e.key === 'Escape') onClose()
            }}
          />
          <button className="btn primary" onClick={() => void exec(input)} disabled={busy}>
            执行
          </button>
        </div>
      </div>
    </div>
  )
}
