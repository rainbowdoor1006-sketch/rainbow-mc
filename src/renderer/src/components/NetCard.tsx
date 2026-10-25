import React, { useState } from 'react'

/**
 * 联机网络体检卡片：测速 + 网络配置 + 自动建议。
 * 结果全部来自本机检测，不需要服务器。
 */

interface Report {
  ifaces: { name: string; ipv4: string[]; ipv6: string[] }[]
  hasIpv6: boolean
  publicIp?: string
  isp?: string
  stun: { ok: boolean; mapped?: string; natType: string; note: string }
  latencies: { name: string; host: string; port: number; ms: number | null }[]
  bestNode?: { name: string; ms: number | null }
  speed?: { ok: boolean; mbps: number; bytes: number; error?: string }
  score: number
  level: 'great' | 'ok' | 'poor' | 'bad'
  suggestions: string[]
}

const LEVEL_TEXT: Record<Report['level'], string> = {
  great: '直连条件很好',
  ok: '可以直连',
  poor: '可能需要中继',
  bad: '直连困难'
}

const LEVEL_COLOR: Record<Report['level'], string> = {
  great: 'var(--jade)',
  ok: 'var(--jade)',
  poor: 'var(--warn)',
  bad: 'var(--err)'
}

const NAT_TEXT: Record<string, string> = {
  open: '开放 / 直连',
  cone: '锥形 NAT',
  symmetric: '对称型 NAT',
  blocked: 'UDP 被拦截',
  unknown: '未知'
}

export function NetCard(): React.ReactElement {
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [withSpeed, setWithSpeed] = useState(true)
  const [open, setOpen] = useState(false)


  React.useEffect(() => {
  }, [])


  const run = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      const r = await window.api.net.check(withSpeed)
      if (r.ok && r.report) {
        setReport(r.report as Report)
        setOpen(true)
      } else setErr(r.message || '检测失败')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">网络体检</div>
      <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.9, marginBottom: 10 }}>
        开房或加入前先测一下：能不能直连、大概多快，会有具体建议。检测只在本机做。
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={busy} onClick={() => void run()}>
          {busy ? '检测中…（约 5~15 秒）' : '开始检测'}
        </button>
        <label className="dim" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={withSpeed} onChange={(e) => setWithSpeed(e.target.checked)} />
          同时测下载速度（多花约 5 秒）
        </label>
        {report && (
          <button className="btn sm" onClick={() => setOpen((v) => !v)}>
            {open ? '收起结果' : '展开结果'}
          </button>
        )}
      </div>

      {err && <div style={{ color: 'var(--err)', fontSize: 12.5, marginTop: 8 }}>{err}</div>}

      {report && open && (
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: LEVEL_COLOR[report.level] }}>{report.score}</span>
            <span style={{ fontSize: 13, color: LEVEL_COLOR[report.level] }}>{LEVEL_TEXT[report.level]}</span>
            <span className="dim" style={{ fontSize: 11.5 }}>
              （0~100，越高越容易直连）
            </span>
          </div>

          <div className="dim" style={{ fontSize: 12.5, lineHeight: 2 }}>
            <div>
              IPv6：<b style={{ color: report.hasIpv6 ? 'var(--jade)' : 'var(--warn)' }}>{report.hasIpv6 ? '有' : '没有'}</b>
              {' · '}NAT：<b style={{ color: 'var(--txt)' }}>{NAT_TEXT[report.stun.natType] ?? report.stun.natType}</b>
              {report.stun.mapped ? `（外网映射 ${report.stun.mapped}）` : ''}
            </div>
            {report.publicIp && (
              <div>
                公网 IP：<b style={{ color: 'var(--txt)' }}>{report.publicIp}</b>
                {report.isp ? ` · ${report.isp}` : ''}
              </div>
            )}
            <div>
              延迟：
              {report.latencies
                .map((l) => `${l.name} ${l.ms === null ? '超时' : l.ms + 'ms'}`)
                .join(' · ')}
            </div>
            {report.speed && (
              <div>
                下载速度：
                <b style={{ color: report.speed.ok ? 'var(--txt)' : 'var(--warn)' }}>
                  {report.speed.ok ? `${report.speed.mbps} MB/s` : report.speed.error || '测速失败'}
                </b>
              </div>
            )}
          </div>

          <div style={{ marginTop: 10 }}>
            <div className="card-title" style={{ marginBottom: 4 }}>
              建议
            </div>
            <ul className="dim" style={{ fontSize: 12.5, lineHeight: 1.95, paddingLeft: 18, margin: 0 }}>
              {report.suggestions.map((s2, i) => (
                <li key={i}>{s2}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

    </div>
  )
}
