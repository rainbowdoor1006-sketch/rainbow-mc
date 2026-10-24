import React, { createContext, useContext, useMemo } from 'react'
import type { LocaleCode, RegionCode, RegionInfo } from '@shared/types'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'
import zhHK from './locales/zh-HK'
import enUS from './locales/en-US'
import enGB from './locales/en-GB'
import jaJP from './locales/ja-JP'
import ruRU from './locales/ru-RU'
import frFR from './locales/fr-FR'
import deDE from './locales/de-DE'
import esES from './locales/es-ES'
import koKR from './locales/ko-KR'

export type Dict = Record<string, string>

/** 繁体基底：zh-HK 在 zh-TW 之上覆盖 */
const BASE_TW: Dict = { ...zhTW, ...zhHK }

export const DICTS: Record<LocaleCode, Dict> = {
  'zh-CN': zhCN,
  'zh-HK': BASE_TW,
  'zh-TW': zhTW,
  'en-US': enUS,
  'en-GB': { ...enUS, ...enGB },
  'ja-JP': jaJP,
  'ru-RU': ruRU,
  'fr-FR': frFR,
  'de-DE': deDE,
  'es-ES': esES,
  'ko-KR': koKR
}

export const LOCALE_NAMES: Record<LocaleCode, string> = {
  'zh-CN': '简体中文',
  'zh-HK': '繁體中文（香港）',
  'zh-TW': '繁體中文（台灣）',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'ja-JP': '日本語',
  'ru-RU': 'Русский',
  'fr-FR': 'Français',
  'de-DE': 'Deutsch',
  'es-ES': 'Español',
  'ko-KR': '한국어'
}

export const REGIONS: RegionInfo[] = [
  { code: 'CN', locale: 'zh-CN', isMainlandChina: true },
  { code: 'HK', locale: 'zh-HK', isMainlandChina: false },
  { code: 'MO', locale: 'zh-HK', isMainlandChina: false },
  { code: 'TW', locale: 'zh-TW', isMainlandChina: false },
  { code: 'RU', locale: 'ru-RU', isMainlandChina: false },
  { code: 'US', locale: 'en-US', isMainlandChina: false },
  { code: 'GB', locale: 'en-GB', isMainlandChina: false },
  { code: 'DE', locale: 'de-DE', isMainlandChina: false },
  { code: 'FR', locale: 'fr-FR', isMainlandChina: false },
  { code: 'JP', locale: 'ja-JP', isMainlandChina: false },
  { code: 'KR', locale: 'ko-KR', isMainlandChina: false },
  { code: 'ES', locale: 'es-ES', isMainlandChina: false },
  { code: 'OTHER', locale: 'en-US', isMainlandChina: false }
]

export function localeForRegion(region: RegionCode): LocaleCode {
  return REGIONS.find((r) => r.code === region)?.locale ?? 'zh-CN'
}

export function isMainlandChina(region: RegionCode): boolean {
  return REGIONS.find((r) => r.code === region)?.isMainlandChina ?? false
}

/** 逐级回退：目标语言 → 英文 → 简体中文 → key 本身 */
export function translate(locale: LocaleCode, key: string): string {
  return DICTS[locale]?.[key] ?? DICTS['en-US']?.[key] ?? DICTS['zh-CN']?.[key] ?? key
}

interface I18nValue {
  locale: LocaleCode
  t: (key: string) => string
  setLocale: (l: LocaleCode) => void
}

const I18nCtx = createContext<I18nValue>({
  locale: 'zh-CN',
  t: (k) => translate('zh-CN', k),
  setLocale: () => undefined
})

export function I18nProvider({
  locale,
  setLocale,
  children
}: {
  locale: LocaleCode
  setLocale: (l: LocaleCode) => void
  children: React.ReactNode
}): React.ReactElement {
  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: (key: string) => translate(locale, key) }),
    [locale, setLocale]
  )
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nCtx)
}
