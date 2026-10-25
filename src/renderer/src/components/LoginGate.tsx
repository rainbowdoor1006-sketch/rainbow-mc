import React from 'react'
import { useI18n } from '@/i18n'
import { IconUser } from './Icons'

/**
 * 登录门禁：没有账号时先建一个离线账号，之后整个启动器可用。
 * 顶部保留窗口控制（最小化/最大化/关闭）与可拖动区域。
 */
export function LoginGate({ onLocalLogin }: { onLocalLogin: () => void }): React.ReactElement {
  const { t } = useI18n()
  const api = window.api

  return (
    <div className="gate">
      <div className="gate-drag" />
      <div className="gate-win">
        <button className="win-btn" onClick={() => api.win.minimize()} title={t('gate.minimize')}>
          &#8211;
        </button>
        <button className="win-btn" onClick={() => api.win.toggleMaximize()} title={t('gate.maximize')}>
          &#9633;
        </button>
        <button className="win-btn close" onClick={() => api.win.close()} title={t('gate.close')}>
          &#10005;
        </button>
      </div>

      <div className="gate-card">
        <div className="brand-mark" style={{ width: 34, height: 34, borderRadius: 9 }} />
        <h2 className="gate-title">{t('gate.title')}</h2>
        <p className="gate-desc">{t('gate.desc')}</p>

        <div className="gate-actions">
          <button className="btn primary lg" onClick={onLocalLogin}>
            <IconUser />
            {t('gate.local')}
          </button>
        </div>
      </div>
    </div>
  )
}
