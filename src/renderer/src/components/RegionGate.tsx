import React, { useState } from 'react'
import { useI18n, REGIONS, LOCALE_NAMES, localeForRegion } from '@/i18n'
import type { RegionCode } from '@shared/types'
import { IconWarn } from './Icons'

/** 首次启动的地区选择 */
export function RegionPicker({ onPick }: { onPick: (r: RegionCode) => void }): React.ReactElement {
  const { t } = useI18n()
  const [hover, setHover] = useState<RegionCode | null>(null)

  return (
    <div className="overlay">
      <div className="modal" style={{ width: 660 }}>
        <h2>{t('settings.region')}</h2>
        <p style={{ marginBottom: 18 }}>{t('settings.languageHint')}</p>
        <div className="grid cols-4" style={{ gap: 10 }}>
          {REGIONS.map((r) => (
            <button
              key={r.code}
              className="btn"
              style={{
                height: 62,
                flexDirection: 'column',
                gap: 3,
                alignItems: 'flex-start',
                padding: '0 14px',
                borderColor: hover === r.code ? 'rgba(79,195,247,.5)' : undefined,
                background: hover === r.code ? 'rgba(79,195,247,.12)' : undefined
              }}
              onMouseEnter={() => setHover(r.code)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick(r.code)}
            >
              <span style={{ fontSize: 13.5, fontWeight: 560 }}>{t('region.' + r.code)}</span>
              <span className="dim" style={{ fontSize: 11 }}>
                {LOCALE_NAMES[localeForRegion(r.code)]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 中国大陆地区法规提示 */
export function MainlandNotice({
  onAck,
  onCancel
}: {
  onAck: () => void
  onCancel: () => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-icon">
          <IconWarn />
        </div>
        <h2>{t('region.cnTitle')}</h2>
        <p>{t('region.cnBody')}</p>
        <p className="dim" style={{ marginTop: 10, fontSize: 12 }}>
          {t('region.cancelHint')}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            {t('region.cancelSelect')}
          </button>
          <button className="btn primary" onClick={onAck}>
            {t('region.ack')}
          </button>
        </div>
      </div>
    </div>
  )
}
