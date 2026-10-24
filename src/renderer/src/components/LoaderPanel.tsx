import React, { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { IconDownload } from './Icons'

type Loader = 'fabric' | 'quilt' | 'forge' | 'neoforge'

const LOADER_LABEL: Record<Loader, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

const ALL: Loader[] = ['fabric', 'quilt', 'forge', 'neoforge']

interface Support {
  fabric: boolean
  quilt: boolean
  forge: boolean
  neoforge: boolean
}

export function LoaderPanel({ onInstalled }: { onInstalled?: () => void }): React.ReactElement {
  const { t } = useI18n()
  const [installed, setInstalled] = useState<{ id: string; type: string }[]>([])
  const [base, setBase] = useState('')
  const [loader, setLoader] = useState<Loader>('fabric')
  const [support, setSupport] = useState<Support | null>(null)
  const [versions, setVersions] = useState<{ version: string; stable?: boolean }[]>([])
  const [loaderVersion, setLoaderVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.mc.installed().then((list) => {
      const plain = list.filter((v) => !/forge|fabric|neoforge|quilt/i.test(v.id))
      const usable = plain.length ? plain : list
      setInstalled(usable)
      if (usable.length) setBase(usable[0].id)
    })
    const off = window.api.loader.onProgress((p) => setMsg(p.message))
    return off
  }, [])

  const loadVersions = useCallback(async () => {
    if (!base) return
    setVersions([])
    setLoaderVersion('')
    setError('')
    const r = await window.api.loader.list(loader, base)
    if (r.support) setSupport(r.support)
    if (!r.ok) {
      setError(r.message || '列表获取失败')
      return
    }
    setVersions(r.list || [])
    if (r.list?.length) setLoaderVersion(r.list[0].version)
  }, [base, loader])

  useEffect(() => {
    void loadVersions()
  }, [loadVersions])

  const supported = support ? support[loader] : true
  const missing = support ? ALL.filter((l) => !support[l]) : []

  const install = async (): Promise<void> => {
    if (!base || !loaderVersion) return
    setBusy(true)
    setError('')
    setMsg('')
    // 2026-10-21：下载页只负责把加载器存进组件库，不安装、不建项目
    const r = await window.api.loader.download(loader, base, loaderVersion)
    setBusy(false)
    if (!r.ok) {
      setError(r.message || '下载失败')
      return
    }
    setMsg(`${t('loader.downloadedToLib')}：${loader} ${loaderVersion}`)
  }

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <div className="card-title">{t('loader.title')}</div>
      <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.8, marginBottom: 16 }}>
        {t('loader.desc')}
      </p>

      <div className="field">
        <label>{t('loader.base')}</label>
        <select className="select" value={base} onChange={(e) => setBase(e.target.value)}>
          {installed.length === 0 && <option value="">{t('loader.noBase')}</option>}
          {installed.map((v) => (
            <option key={v.id} value={v.id}>
              {v.id}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>{t('loader.type')}</label>
        <div className="filters">
          {ALL.map((l) => {
            const ok = support ? support[l] : true
            return (
              <button
                key={l}
                className={'subtab' + (loader === l ? ' active' : '')}
                disabled={!ok}
                title={ok ? '' : t('loader.unsupported')}
                style={ok ? undefined : { opacity: 0.35, cursor: 'not-allowed' }}
                onClick={() => ok && setLoader(l)}
              >
                {LOADER_LABEL[l]}
              </button>
            )
          })}
        </div>
        {missing.length > 0 && (
          <span className="hint" style={{ marginTop: 6 }}>
            {t('loader.unsupportedList')}：{missing.map((m) => LOADER_LABEL[m]).join(' / ')}
          </span>
        )}
      </div>

      <div className="field">
        <label>{t('loader.version')}</label>
        <select
          className="select"
          value={loaderVersion}
          onChange={(e) => setLoaderVersion(e.target.value)}
          disabled={!supported}
        >
          {versions.length === 0 && <option value="">{t('common.none')}</option>}
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              {v.version}
              {v.stable ? ' ★' : ''}
            </option>
          ))}
        </select>
      </div>

      {error && <div style={{ color: 'var(--err)', fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
      {busy && msg && <div className="dim" style={{ fontSize: 12, marginBottom: 10 }}>{msg}</div>}
      {!busy && msg && <div style={{ color: 'var(--ok)', fontSize: 12.5, marginBottom: 10 }}>{msg}</div>}

      <button
        className="btn primary"
        disabled={busy || !base || !loaderVersion || !supported}
        onClick={() => void install()}
      >
        <IconDownload />
        {busy ? t('loader.installing') : t('loader.install')}
      </button>
    </div>
  )
}
