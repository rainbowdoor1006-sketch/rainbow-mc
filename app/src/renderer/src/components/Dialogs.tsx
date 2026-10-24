import React, { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
import { IconFolder, IconWarn } from './Icons'

/** 选择已安装版本 → 新建项目 */
export function ProjectPicker({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [installed, setInstalled] = useState<{ id: string; type: string }[]>([])
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.mc.installed().then((list) => {
      setInstalled(list)
      if (list.length) {
        setSelected(list[0].id)
        setName(list[0].id)
      }
    })
  }, [])

  const create = async (): Promise<void> => {
    if (!selected) return
    setBusy(true)
    await window.api.project.create(name || selected, selected, 'vanilla')
    setBusy(false)
    onCreated()
  }

  return (
    <div className="overlay">
      <div className="modal">
        <h2>{t('project.create')}</h2>
        {installed.length === 0 ? (
          <p>{t('project.emptyInstalled')}</p>
        ) : (
          <>
            <div className="field">
              <label>{t('home.mcVersion')}</label>
              <select className="select" value={selected} onChange={(e) => setSelected(e.target.value)}>
                {installed.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id} · {v.type}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t('home.projectName')}</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!selected || busy} onClick={() => void create()}>
            {t('common.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function LaunchError({
  errorCode,
  message,
  onClose,
  onOpenLogs
}: {
  errorCode: string
  message?: string
  onClose: () => void
  onOpenLogs: () => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-icon" style={{ background: 'rgba(255,107,129,.12)', color: 'var(--err)' }}>
          <IconWarn />
        </div>
        <h2>
          {t('launch.errorTitle')}（{errorCode}）
        </h2>
        {message && <p className="dim" style={{ marginTop: 8, fontSize: 12.5 }}>{message}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('launch.errorAck')}
          </button>
          <button className="btn primary" onClick={onOpenLogs}>
            <IconFolder />
            {t('launch.openLogFolder')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 启动中：显示实时日志 */
export function LaunchOverlay({
  lines,
  onClose,
  onKill
}: {
  lines: string[]
  onClose: () => void
  onKill?: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const tail = useMemo(() => lines.slice(-200), [lines])
  return (
    <div className="overlay">
      <div className="modal" style={{ width: 720 }}>
        <h2>{t('launch.running')}</h2>
        <div
          className="mono"
          style={{
            height: 320,
            overflowY: 'auto',
            background: 'rgba(4,8,13,.75)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 12,
            fontSize: 11.5,
            lineHeight: 1.7,
            color: 'var(--txt-dim)',
            whiteSpace: 'pre-wrap'
          }}
        >
          {tail.join('\n')}
        </div>
        <div className="modal-actions">
          {onKill && (
            <button className="btn danger" onClick={onKill}>
              {t('launch.forceStop')}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 纯离线登录：不连接任何服务器，填个昵称就能玩。
 * 单个昵称即可开始游玩，适合单机。
 */
export function LocalLogin({ onClose, onDone }: { onClose: () => void; onDone: () => void }): React.ReactElement {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const r = await window.api.account.localLogin(name.trim())
    setBusy(false)
    if (!r.ok) {
      setError(r.message || r.errorCode || 'error')
      return
    }
    onDone()
  }

  return (
    <div className="overlay">
      <div className="modal">
        <h2>{t('accounts.local')}</h2>
        <p style={{ marginBottom: 16 }}>{t('accounts.localHint')}</p>
        <div className="field">
          <label>{t('accounts.offlineName')}</label>
          <input
            className="input"
            value={name}
            placeholder="Steve"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <span className="hint">{t('accounts.nameRule')}</span>
        </div>
        {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? t('common.loading') : t('accounts.localStart')}
          </button>
        </div>
      </div>
    </div>
  )
}
/** 账号列表：在已保存的账号之间切换（切换不会清掉各账号的登录状态） */
export function AccountsDialog({
  accounts,
  activeId,
  onSwitch,
  onRemove,
  onClose
}: {
  accounts: { id: string; name: string; mode: string; uuid: string }[]
  activeId?: string
  onSwitch: (id: string) => void
  onRemove: (id: string) => void
  onClose: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const label = (mode: string): string =>
    t('accounts.local')

  return (
    <div className="overlay">
      <div className="modal">
        <h2>{t('accounts.login')}</h2>
        <p style={{ marginBottom: 14 }}>{t('accounts.switchHint')}</p>
        <div className="vlist" style={{ maxHeight: 320, overflow: 'auto' }}>
          {accounts.map((a) => (
            <div className="vrow" key={a.id} style={{ alignItems: 'center' }}>
              <span className="vid" style={{ minWidth: 140 }}>{a.name}</span>
              <span className="tag">{label(a.mode)}</span>
              <span className="vmeta mono">{a.uuid.slice(0, 8)}</span>
              <span className="vspacer" />
              {a.id === activeId ? (
                <span className="tag ok">{t('accounts.current')}</span>
              ) : (
                <button className="btn sm" onClick={() => onSwitch(a.id)}>
                  {t('accounts.switch')}
                </button>
              )}
              <button className="btn sm ghost" onClick={() => onRemove(a.id)}>
                {t('common.delete')}
              </button>
            </div>
          ))}
          {!accounts.length && <div className="empty">{t('accounts.notLoggedIn')}</div>}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
