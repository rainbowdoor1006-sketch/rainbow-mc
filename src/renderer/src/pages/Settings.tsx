import React, { useState } from 'react'
import { useI18n, LOCALE_NAMES, REGIONS } from '@/i18n'
import type { AppSettings, LocaleCode, RegionCode } from '@shared/types'
import { IconFolder } from '@/components/Icons'
import { BackgroundCrop } from '@/components/BackgroundCrop'

const LOCALES = Object.keys(LOCALE_NAMES) as LocaleCode[]

export function Settings({
  settings,
  onChange,
  onPickRegion,
  onRefresh
}: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  onPickRegion: (r: RegionCode) => void
  onRefresh: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const appearance = settings.appearance
  const [cropData, setCropData] = useState('')
  const [bgBusy, setBgBusy] = useState(false)
  const [lib, setLib] = useState<
    { id: string; title: string; kind: string; versionNumber: string; size: number }[]
  >([])
  const [libMsg, setLibMsg] = useState('')

  const reloadLib = async (): Promise<void> => {
    setLib((await window.api.library.list()) as never)
  }

  React.useEffect(() => {
    void reloadLib()
  }, [])

  const pickBackground = async (): Promise<void> => {
    const r = await window.api.appearance.pickImage()
    if (!r.ok || !r.dataUrl) return
    setCropData(r.dataUrl)
  }

  const applyCropped = async (dataUrl: string): Promise<void> => {
    setBgBusy(true)
    const r = await window.api.appearance.saveBackground(dataUrl)
    setBgBusy(false)
    setCropData('')
    if (r.ok) onRefresh()
  }

  const setAppearance = async (patch: Partial<typeof appearance>): Promise<void> => {
    await window.api.appearance.update(patch)
    onRefresh()
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('settings.title')}</div>
        <div className="page-desc">{t('settings.desc')}</div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">{t('settings.language')} / {t('settings.region')}</div>

          <div className="field">
            <label>{t('settings.language')}</label>
            <select
              className="select"
              value={settings.locale}
              onChange={(e) => onChange({ locale: e.target.value as LocaleCode })}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </select>
            <span className="hint">{t('settings.languageHint')}</span>
          </div>

          <div className="field">
            <label>{t('settings.region')}</label>
            <select
              className="select"
              value={settings.region}
              onChange={(e) => onPickRegion(e.target.value as RegionCode)}
            >
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {t('region.' + r.code)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>{t('settings.downloadSource')}</label>
            <select
              className="select"
              value={settings.downloadSource}
              onChange={(e) => onChange({ downloadSource: e.target.value as 'official' | 'mirror' })}
            >
              <option value="official">{t('settings.official')}</option>
              <option value="mirror">{t('settings.mirror')}</option>
            </select>
          </div>

          <div className="field">
            <label>{t('update.autoCheck')}</label>
            <div className="row" style={{ gap: 10 }}>
              <button
                className={'toggle' + (settings.autoCheckUpdate ? ' on' : '')}
                onClick={() => onChange({ autoCheckUpdate: !settings.autoCheckUpdate })}
                aria-pressed={settings.autoCheckUpdate}
              >
                <span className="toggle-knob" />
              </button>
              <span className="dim" style={{ fontSize: 12 }}>
                {settings.autoCheckUpdate ? '已开启' : '已关闭'}
              </span>
            </div>
          </div>


          <div className="field">
            <label>{t('update.channel')}</label>
            <select
              className="select"
              value={settings.updateChannel}
              onChange={(e) => onChange({ updateChannel: e.target.value as 'stable' | 'beta' })}
            >
              <option value="stable">stable（稳定版）</option>
              <option value="beta">beta（测试版）</option>
            </select>
          </div>
        </div>

        <div className="card">
          <div className="card-title">CurseForge 整合包</div>

          <div className="field">
            <label>下载代理地址</label>
            <input
              className="input"
              value={settings.cfApiBase ?? ''}
              placeholder="（可选）自建 CurseForge 代理地址"
              onChange={(e) => onChange({ cfApiBase: e.target.value })}
            />
            <div className="dim" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.7 }}>
              CurseForge 的整合包只带「项目 ID / 文件 ID」，要下载模组必须换直链。
              填入自建 CurseForge 代理地址，或留空使用免 Key 通道。
            </div>
          </div>

          <div className="field">
            <label>自己的 CurseForge API Key（可选）</label>
            <input
              className="input"
              value={settings.curseforgeApiKey ?? ''}
              placeholder="代理不可用时才会用到"
              onChange={(e) => onChange({ curseforgeApiKey: e.target.value })}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('settings.java')}</div>

          <div className="field">
            <label>{t('settings.memory')}</label>
            <input
              className="input"
              type="number"
              min={1024}
              max={32768}
              step={512}
              value={settings.maxMemoryMb}
              onChange={(e) => onChange({ maxMemoryMb: Number(e.target.value) || 4096 })}
            />
            <span className="hint">{t('settings.memoryHint')}</span>
          </div>

          <div className="field">
            <label className="row-between">
              <span>{t('settings.autoJava')}</span>
              <span
                className={'switch' + (settings.autoJava ? ' on' : '')}
                onClick={() => onChange({ autoJava: !settings.autoJava })}
              />
            </label>
          </div>

          <div className="field">
            <label>{t('settings.java')}</label>
            <input
              className="input mono"
              value={settings.javaPath}
              placeholder="C:\\Program Files\\Java\\bin\\javaw.exe"
              onChange={(e) => onChange({ javaPath: e.target.value })}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('appearance.title')}</div>

          <div className="field">
            <label>{t('appearance.background')}</label>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                className={'mat-btn' + (appearance.backgroundMode === 'default' ? ' active' : '')}
                onClick={() => {
                  void window.api.appearance.setDefault().then(() => onRefresh())
                }}
              >
                {t('appearance.bgDefault')}
              </button>
              <button
                className={'mat-btn' + (appearance.backgroundMode === 'preset' ? ' active' : '')}
                onClick={() => {
                  void window.api.appearance.setPreset().then(() => onRefresh())
                }}
              >
                {t('appearance.bgPreset')}
              </button>
              <button className="btn" onClick={() => void pickBackground()} disabled={bgBusy}>
                <IconFolder />
                {t('appearance.choose')}
              </button>
            </div>
            <span className="hint">
              {appearance.backgroundMode === 'image'
                ? t('appearance.current')
                : appearance.backgroundMode === 'preset'
                  ? t('appearance.currentPreset')
                  : t('appearance.none')}
            </span>
          </div>

          <div className="field">
            <label>{t('appearance.dim')}</label>
            <input
              type="range"
              min={0}
              max={80}
              step={1}
              value={appearance.backgroundDim}
              onChange={(e) => void setAppearance({ backgroundDim: Number(e.target.value) })}
              style={{ accentColor: appearance.accent }}
            />
          </div>

          <div className="field">
            <label>{t('appearance.material')}</label>
            <div className="row" style={{ gap: 8 }}>
              {(['dark', 'warm', 'glass'] as const).map((m) => (
                <button
                  key={m}
                  className={'mat-btn' + (appearance.material === m ? ' active' : '')}
                  onClick={() => void setAppearance({ material: m })}
                >
                  <span className={'mat-dot ' + m} />
                  {t('appearance.' + m)}
                </button>
              ))}
            </div>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label>{t('appearance.accent')}</label>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <input
                type="color"
                value={appearance.accent}
                onChange={(e) => void setAppearance({ accent: e.target.value })}
                style={{ width: 44, height: 30, background: 'transparent', border: 'none' }}
              />
              {['#7fb69b', '#8aa7d6', '#c98b8b', '#c9a227', '#9b8ad6', '#5aa9a0'].map((c) => (
                <button
                  key={c}
                  className="color-dot"
                  style={{ background: c, outline: appearance.accent === c ? '2px solid var(--txt)' : 'none' }}
                  onClick={() => void setAppearance({ accent: c })}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('library.title')}</div>
          {!lib.length && <div className="dim" style={{ fontSize: 12 }}>{t('library.empty')}</div>}
          {lib.map((x) => (
            <div key={x.id} className="dep-row">
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {x.title}
                <span className="dim" style={{ fontSize: 11, marginLeft: 6 }}>
                  {x.versionNumber} · {x.kind} · {(x.size / 1024 / 1024).toFixed(1)} MB
                </span>
              </span>
              <button
                className="btn sm"
                onClick={() => {
                  void window.api.library.usage(x.id).then((u) => {
                    setLibMsg(u.length ? `${x.title}：${u.join('、')}` : `${x.title}：${t('library.unused')}`)
                  })
                }}
              >
                {t('library.usedBy')}
              </button>
              <button
                className="btn sm"
                onClick={() => {
                  void window.api.library.remove(x.id).then((r) => {
                    setLibMsg(`${t('library.delete')} ${x.title}`)
                    void reloadLib()
                    void r
                  })
                }}
              >
                {t('library.delete')}
              </button>
            </div>
          ))}
          {libMsg && <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>{libMsg}</div>}
        </div>

                <div className="card">
          <div className="card-title">{t('settings.msTitle')}</div>
          <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
            {t('settings.msFixed')}
          </p>
        </div>
<div className="card">
          <div className="card-title">{t('settings.logs')}</div>
          <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.8, marginBottom: 14 }}>
            {t('settings.logsHint')}
          </p>
          <button className="btn" onClick={() => window.api.openLogs()}>
            <IconFolder />
            {t('settings.openLogs')}
          </button>
        </div>
      </div>

      {cropData && (
        <BackgroundCrop
          dataUrl={cropData}
          onCancel={() => setCropData('')}
          onDone={(d) => void applyCropped(d)}
        />
      )}
    </>
  )
}
