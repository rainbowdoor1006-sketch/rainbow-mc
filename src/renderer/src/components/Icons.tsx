import React from 'react'

type IconProps = { className?: string }

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24'
}

export function IconHome(_p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M9.5 20v-5.5h5V20" />
    </svg>
  )
}

export function IconVersions(_p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M12 2.8 21 7.4v9.2L12 21.2 3 16.6V7.4z" />
      <path d="m3 7.4 9 4.6 9-4.6" />
      <path d="M12 12v9.2" />
    </svg>
  )
}

export function IconDownload(_p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M12 3.5v11" />
      <path d="m7.5 10 4.5 4.5 4.5-4.5" />
      <path d="M4 17.5v1A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-1" />
    </svg>
  )
}

export function IconPuzzle(_p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M9 4.5a2 2 0 1 1 4 0V6h2.5A1.5 1.5 0 0 1 17 7.5V10h1.5a2 2 0 1 1 0 4H17v2.5A1.5 1.5 0 0 1 15.5 18H13v1.5a2 2 0 1 1-4 0V18H6.5A1.5 1.5 0 0 1 5 16.5V14H3.5a2 2 0 1 1 0-4H5V7.5A1.5 1.5 0 0 1 6.5 6H9z" />
    </svg>
  )
}

export function IconUser(_p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20.5c1.3-3.9 4-5.6 7.5-5.6s6.2 1.7 7.5 5.6" />
    </svg>
  )
}

export function IconGear(_p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M4.5 12H2M22 12h-2.5M6.2 6.2 4.4 4.4M19.6 19.6l-1.8-1.8M17.8 6.2l1.8-1.8M4.4 19.6l1.8-1.8" />
    </svg>
  )
}

export function IconMore(_p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </svg>
  )
}

export function IconPlay(_p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  )
}

export function IconStop(_p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.6" />
    </svg>
  )
}

export function IconWarn(_p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M12 3.5 22 20H2z" />
      <path d="M12 9.5v5M12 17.2v.1" />
    </svg>
  )
}

export function IconFolder(_p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" />
    </svg>
  )
}

export function IconPlus(_p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export type { IconProps }

export function IconLink(p: IconProps): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.7 5.23" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07l1.42-1.42" />
    </svg>
  )
}