import { app } from 'electron'
import { join } from 'path'
import { paths } from '../paths'
import type { AppSettings } from '@shared/types'

const OFFICIAL_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const MIRROR_MANIFEST = 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json'

const HOST_MAP: [RegExp, string][] = [
  [/^https?:\/\/piston-meta\.mojang\.com/i, 'https://bmclapi2.bangbang93.com'],
  [/^https?:\/\/launcher\.mojang\.com/i, 'https://bmclapi2.bangbang93.com'],
  [/^https?:\/\/launchermeta\.mojang\.com/i, 'https://bmclapi2.bangbang93.com'],
  [/^https?:\/\/resources\.download\.minecraft\.net/i, 'https://bmclapi2.bangbang93.com/assets'],
  [/^https?:\/\/piston-data\.mojang\.com/i, 'https://bmclapi2.bangbang93.com'],
  [/^https?:\/\/libraries\.minecraft\.net/i, 'https://bmclapi2.bangbang93.com/maven']
]

export function manifestUrl(source: AppSettings['downloadSource']): string {
  return source === 'mirror' ? MIRROR_MANIFEST : OFFICIAL_MANIFEST
}

/** 把 Mojang 官方 URL 换成镜像地址（仅 mirror 模式） */
export function rewriteUrl(url: string, source: AppSettings['downloadSource']): string {
  if (source !== 'mirror') return url
  for (const [re, host] of HOST_MAP) {
    if (re.test(url)) return url.replace(re, host)
  }
  return url
}

/** 官方资源的通用 CDN 前缀（assets 对象） */
export function resourceUrl(hash: string, source: AppSettings['downloadSource']): string {
  const sub = hash.slice(0, 2)
  if (source === 'mirror') return `https://bmclapi2.bangbang93.com/assets/${sub}/${hash}`
  return `https://resources.download.minecraft.net/${sub}/${hash}`
}

export function versionsDir(): string {
  return paths.versions()
}

export function versionDir(id: string): string {
  return join(versionsDir(), id)
}

export function librariesDir(): string {
  return paths.libraries()
}

export function assetsDir(): string {
  return paths.assets()
}

export function runtimeDir(): string {
  return paths.runtime()
}

export function cacheDir(): string {
  return join(paths.cache(), 'mc')
}

export function appVersion(): string {
  return app.getVersion()
}
