import React from 'react'
import { useI18n } from '@/i18n'
import type { Page } from '@/App'
import { IconDownload, IconFolder, IconGear, IconLink, IconMore, IconPlay } from './Icons'

const TABS: { id: Page; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'launch', label: 'nav.launch', icon: IconPlay },
  { id: 'download', label: 'nav.download', icon: IconDownload },
  { id: 'library', label: 'nav.library', icon: IconFolder },
  { id: 'multiplayer', label: 'nav.multiplayer', icon: IconLink },
  { id: 'settings', label: 'nav.settings', icon: IconGear },
  { id: 'more', label: 'nav.more', icon: IconMore }
]

export function TopBar({
  page,
  setPage
}: {
  page: Page
  setPage: (p: Page) => void
}): React.ReactElement {
  const { t } = useI18n()
  const api = window.api

  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-mark" />
        <span>RAINBOW MC</span>
      </div>
      <div className="tabs">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              className={'tab' + (page === tab.id ? ' active' : '')}
              onClick={() => setPage(tab.id)}
            >
              <Icon />
              {t(tab.label)}
            </button>
          )
        })}
      </div>
      <div className="win-btns">
        <button className="win-btn" onClick={() => api.win.minimize()} aria-label="minimize">
          &#8211;
        </button>
        <button className="win-btn" onClick={() => api.win.toggleMaximize()} aria-label="maximize">
          &#9633;
        </button>
        <button className="win-btn close" onClick={() => api.win.close()} aria-label="close">
          &#10005;
        </button>
      </div>
    </div>
  )
}
