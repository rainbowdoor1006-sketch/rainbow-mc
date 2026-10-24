import React, { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n'

interface MpStatus {
  installed: boolean
  running: boolean
  port: number
  version?: string
  easytier?: string
  room?: string
  state: string
  index: number
  members: { name: string; kind?: string }[]
  difficulty?: string
}

const STATE_TEXT: Record<string, string> = {
  stopped: '联机服务未启动',
  waiting: '待机中',
  'host-scanning': '正在等待你进入存档并「对局域网开放」',
  'host-starting': '正在创建房间…',
  'host-ok': '房间已就绪',
  'guest-connecting': '正在连接房主…',
  'guest-starting': '正在建立连接…',
  'guest-ok': '已加入房间',
  exception: '联机出现异常'
}

const DIFF_TEXT: Record<string, string> = {
  EASIEST: '直连（网络条件极佳）',
  SIMPLE: '直连（网络良好）',
  MEDIUM: '可能需要中转',
  HARD: '需要中转（延迟会高一些）',
  UNKNOWN: '未知'
}

export function Multiplayer({ playerName }: { playerName: string }): React.ReactElement {
  const { t } = useI18n()
  const [status, setStatus] = useState<MpStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [progress, setProgress] = useState('')
  const [code, setCode] = useState('')
  const [showSecurity, setShowSecurity] = useState(true)
  const [showTips, setShowTips] = useState(false)

  const refresh = useCallback(async () => {
    const s = (await window.api.mp.status()) as MpStatus
    setStatus(s)
  }, [])

  useEffect(() => {
    void refresh()
    const offState = window.api.mp.onState((s) => setStatus(s as MpStatus))
    const offProg = window.api.mp.onProgress((p) => setProgress(p.message || ''))
    const timer = setInterval(() => void refresh(), 1500)
    return () => {
      offState?.()
      offProg?.()
      clearInterval(timer)
    }
  }, [refresh])

  const install = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    const r = await window.api.mp.install()
    setBusy(false)
    setProgress('')
    if (!r.ok) setMsg(r.message || '启用失败')
    else setMsg('联机组件已就绪')
    void refresh()
  }

  const host = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    const r = await window.api.mp.host(playerName)
    setBusy(false)
    if (!r.ok) setMsg(r.message || '创建房间失败')
    void refresh()
  }

  const joinRoom = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    const r = await window.api.mp.join(code, playerName)
    setBusy(false)
    if (!r.ok) setMsg(r.message || '加入失败')
    void refresh()
  }

  const closeRoom = async (): Promise<void> => {
    setBusy(true)
    await window.api.mp.idle()
    setBusy(false)
    setCode('')
    void refresh()
  }

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setMsg('邀请码已复制')
    } catch {
      setMsg('复制失败，请手动选中复制')
    }
  }

  const st = status?.state ?? 'stopped'
  const isHost = st.startsWith('host')
  const isGuest = st.startsWith('guest')
  const installed = status?.installed

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('mp.title')}</div>
        <div className="page-desc">{t('mp.desc')}</div>
        {status?.running && (
          <span className="tag ok">
            {status.version ? `Terracotta ${status.version}` : '联机服务运行中'}
          </span>
        )}
      </div>

      {/* 状态卡：当前状态 + 成员 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">{t('mp.state')}</div>
        <div className="row-between">
          <span style={{ fontSize: 15 }}>{STATE_TEXT[st] || st}</span>
          {status?.difficulty && (
            <span className="dim" style={{ fontSize: 12.5 }}>
              {DIFF_TEXT[status.difficulty] || status.difficulty}
            </span>
          )}
        </div>
        {status?.room && (
          <div className="row" style={{ gap: 12, marginTop: 14, alignItems: 'center' }}>
            <span className="dim" style={{ fontSize: 12.5 }}>
              {isHost ? '邀请码（发给朋友）' : '房间'}
            </span>
            <span className="mono" style={{ fontSize: 22, letterSpacing: 1 }}>
              {status.room}
            </span>
            <button className="btn sm" onClick={() => void copy(status.room as string)}>
              复制
            </button>
          </div>
        )}
        {!!status?.members?.length && (
          <div className="dim" style={{ fontSize: 12.5, marginTop: 12 }}>
            房间成员：{status.members.map((m) => m.name).join('、')}
          </div>
        )}
      </div>

      {/* 操作区 */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <div className="card-title">{t('mp.host')}</div>
          <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
            你在自己电脑上建房间，朋友用邀请码加入，不需要任何人开服务器。
            <br />
            先进入存档 → Esc → <b>对局域网开放</b>，再点下面的按钮。
          </p>
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <button className="btn primary" disabled={busy || isHost} onClick={() => void host()}>
              {isHost ? '房间已开启' : '创建房间'}
            </button>
            {(isHost || isGuest) && (
              <button className="btn" disabled={busy} onClick={() => void closeRoom()}>
                {isHost ? '关闭房间' : '离开房间'}
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('mp.join')}</div>
          <div className="field" style={{ marginTop: 8 }}>
            <input
              className="input mono"
              placeholder="U/XXXX-XXXX-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <span className="hint">粘贴朋友给你的邀请码，短横线和大小写都可以不管</span>
          </div>
          <button className="btn primary" style={{ marginTop: 12 }} disabled={busy || !code.trim()} onClick={() => void joinRoom()}>
            加入房间
          </button>
        </div>
      </div>

      {msg && (
        <div className="dim" style={{ fontSize: 12.5, marginTop: 12 }}>
          {msg}
        </div>
      )}
      {progress && (
        <div className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>
          {progress}
        </div>
      )}

      {!installed && (
        <div className="card tight" style={{ marginTop: 16, borderColor: 'rgba(127,182,155,.4)' }}>
          <div className="card-title">{t('mp.enable')}</div>
          <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
            首次使用需要下载联机组件（约 8 MB，来自陶瓦联机官方发布包，带哈希校验）。
          </p>
          <button className="btn primary" disabled={busy} onClick={() => void install()}>
            下载并启用
          </button>
        </div>
      )}

      {showSecurity && (
        <div className="card tight" style={{ marginTop: 16, borderColor: 'rgba(201,170,106,.45)' }}>
          <div className="row-between">
            <div className="card-title" style={{ marginBottom: 0 }}>
              {t('mp.security')}
            </div>
            <button className="btn sm ghost" onClick={() => setShowSecurity(false)}>
              知道了
            </button>
          </div>
          <ul className="dim" style={{ fontSize: 12.5, lineHeight: 1.95, marginTop: 10, paddingLeft: 18 }}>
            <li>邀请码等于进房钥匙，<b>只发给要一起玩的人</b>，用完点「关闭房间」</li>
            <li>联机时会建立一块虚拟网卡，建议把它的网络类型设为「公用网络」</li>
            <li>只转发 Minecraft 的端口，不会开放你电脑上的其他服务</li>
            <li>房客默认以离线身份进入，不校验正版</li>
          </ul>
        </div>
      )}

      <div className="card tight" style={{ marginTop: 16 }}>
        <div className="row-between">
          <div className="card-title" style={{ marginBottom: 0 }}>
            大型整合包联机优化
          </div>
          <button className="btn sm ghost" onClick={() => setShowTips((v) => !v)}>
            {showTips ? '收起' : '展开'}
          </button>
        </div>
        {showTips && (
          <ul className="dim" style={{ fontSize: 12.5, lineHeight: 1.95, marginTop: 10, paddingLeft: 18 }}>
            <li>房主上行带宽决定流畅度：500+ 模组建议 2~3 人，房主上行 20 Mbps 以上</li>
            <li>进服前让房主先在存档里走一圈，减少首次进服时的区块同步卡顿</li>
            <li>建议把视距调到 8~12，模拟距离不超过视距</li>
            <li>房主关掉下载、直播、网盘同步等占上行的东西</li>
            <li>如果状态显示「需要中转」，延迟会高一些，属正常现象</li>
          </ul>
        )}
      </div>

      <div className="dim" style={{ fontSize: 11.5, marginTop: 18 }}>
        联机能力由{' '}
        <a href="https://github.com/burningtnt/Terracotta" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
          Terracotta | 陶瓦联机
        </a>{' '}
        提供（AGPL-3.0，基于 EasyTier）。本启动器仅通过其本地接口调用，未修改该程序。
      </div>
    </>
  )
}
