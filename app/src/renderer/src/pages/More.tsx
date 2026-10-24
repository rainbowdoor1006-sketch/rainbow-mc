import React, { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import type { AppSettings, AppState } from '@shared/types'
import { IconFolder, IconUser } from '@/components/Icons'

export function More({
  state,
  applySettings
}: {
  state: AppState
  applySettings: (patch: Partial<AppSettings>) => Promise<void>
}): React.ReactElement {
  const { t } = useI18n()
  const [version, setVersion] = useState('')
  const [paths, setPaths] = useState<{ root: string; logs: string } | null>(null)
  const [updateMsg, setUpdateMsg] = useState('')

  useEffect(() => {
    window.api.getVersion().then(setVersion)
    window.api.getPaths().then(setPaths)
  }, [])

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('more.title')}</div>
        <div className="page-desc">{t('more.desc')}</div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-title">账号</div>
          <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
            本版本只支持离线登录：填一个昵称即可游玩单机与离线服务器。
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('settings.logs')}</div>
          <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.9, marginBottom: 14 }}>
            {t('settings.logsHint')}
          </div>
          <button className="btn" onClick={() => window.api.openLogs()}>
            <IconFolder />
            {t('settings.openLogs')}
          </button>
          <div className="mono dim mt-16" style={{ fontSize: 11, wordBreak: 'break-all' }}>
            {paths?.logs}
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('settings.about')}</div>
          <div className="dim" style={{ fontSize: 12.5, lineHeight: 2 }}>
            RAINBOW MC v{version}
            <br />
            {t('settings.region')}：{t('region.' + state.settings.region)} · {t('settings.language')}：
            {state.settings.locale}
          </div>
          <div className="mono dim mt-16" style={{ fontSize: 11, wordBreak: 'break-all' }}>
            {paths?.root}
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('settings.updateCheck')}</div>
          <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.9, marginBottom: 12 }}>
            {t('more.updateHint')}
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <input
              className="input mono"
              placeholder="https://example.com/latest.json"
              value={state.settings.updateManifestUrl}
              onChange={(e) => void applySettings({ updateManifestUrl: e.target.value })}
            />
          </div>
          <div className="row-between">
            <button
              className="btn sm"
              onClick={() =>
                void window.api.update.check().then((r) => {
                  if (!r.ok) setUpdateMsg((r.message || t('update.checkFailed')) + '')
                  else if (r.state === 'older' && r.latest)
                    setUpdateMsg(`${t('update.title')}：${r.latest.version}`)
                  else if (r.state === 'newer' && r.latest)
                    setUpdateMsg(`本地 ${r.local.version} 比官网 ${r.latest.version} 新`)
                  else setUpdateMsg(t('update.upToDate'))
                })
              }
            >
              {t('update.checkNow')}
            </button>
            {updateMsg && <span className="dim" style={{ fontSize: 11.5 }}>{updateMsg}</span>}
          </div>
        </div>
      </div>
    </>
  )
}
