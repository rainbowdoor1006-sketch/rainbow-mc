import React, { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import type { AppSettings, AppState } from '@shared/types'
import { IconFolder, IconGithub, IconUser } from '@/components/Icons'

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
  const [memBusy, setMemBusy] = useState(false)
  const [memPanel, setMemPanel] = useState(false)
  const [memResult, setMemResult] = useState('')

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
          <div className="card-title">{t('accounts.title')}</div>
          <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.9, marginBottom: 14 }}>
            账号只保存在本机，用于单机与离线服务器。
          </div>
          <button className="btn block" onClick={() => window.api.openLogs()} >
            <IconUser />
            {t('accounts.login')}
          </button>
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

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-title">快捷入口</div>
          <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.9, marginBottom: 14 }}>
            三个常用操作，不用离开启动器。
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" disabled={memBusy} onClick={() => setMemPanel(true)}>
              优化电脑内存
            </button>
            <button className="btn" onClick={() => void window.api.openUrl('https://rainbowdoor.icu')}>
              前往社团网站
            </button>
            <button
              className="btn"
              onClick={() =>
                void window.api.openUrl('https://github.com/rainbowdoor1006-sketch/rainbow-mc')
              }
            >
              <IconGithub />
              前往 GitHub 社区
            </button>
          </div>
        </div>

      </div>

      {memPanel && (
        <div className="overlay" onClick={() => !memBusy && setMemPanel(false)}>
          <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 6 }}>优化电脑内存</h2>
            <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
              会回收「最近没访问的内存页」，进程本身照常运行，不结束任何程序。
            </p>
            <div style={{ display: 'grid', gap: 10, margin: '16px 0' }}>
              {[
                {
                  level: 'safe' as const,
                  title: '温和（推荐）',
                  desc: '只处理后台、占用超过 200 MB 的程序；当前窗口不动，看不到卡顿'
                },
                {
                  level: 'aggressive' as const,
                  title: '极致',
                  desc: '处理全部非系统关键进程（含浏览器、聊天软件）；释放最多，切回这些程序时可能有 1~2 秒重载'
                },
                {
                  level: 'own' as const,
                  title: '只清启动器',
                  desc: '完全不碰其他程序，只回收启动器自己'
                }
              ].map((o) => (
                <button
                  key={o.level}
                  disabled={memBusy}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    whiteSpace: 'normal',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--line)',
                    borderRadius: 12,
                    padding: '12px 14px',
                    color: 'inherit',
                    font: 'inherit',
                    cursor: memBusy ? 'default' : 'pointer',
                    opacity: memBusy ? 0.6 : 1
                  }}
                  onClick={() => {
                    setMemBusy(true)
                    setMemResult('正在回收…')
                    void window.api.mem.optimize(o.level).then((r) => {
                      setMemBusy(false)
                      setMemResult(r.ok ? r.message : r.message || '优化失败')
                    })
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{o.title}</div>
                  <div className="dim" style={{ fontSize: 12, lineHeight: 1.7 }}>
                    {o.desc}
                  </div>
                </button>
              ))}
            </div>
            {memResult && (
              <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
                {memResult}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" disabled={memBusy} onClick={() => setMemPanel(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  )
}
