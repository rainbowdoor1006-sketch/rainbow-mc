import { createHash } from 'crypto'
import type { AccountInfo } from '@shared/types'

/** 离线模式的 UUID：md5("OfflinePlayer:" + name)，格式化成带横线的 UUID */
export function offlineUuid(name: string): string {
  const hash = createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest('hex')
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32)
  ].join('-')
}

export function makeOfflineAccount(name: string): AccountInfo {
  return {
    id: 'offline-' + offlineUuid(name),
    name,
    uuid: offlineUuid(name),
    mode: 'offline',
    createdAt: Date.now()
  }
}

export function isValidOfflineName(name: string): boolean {
  return /^[A-Za-z0-9_]{3,16}$/.test(name)
}

/** 离线账号：仅本地游玩 */
export function makeLocalAccount(name: string): AccountInfo {
  const uuid = offlineUuid(name + '|local|' + Math.random().toString(36).slice(2))
  return {
    id: 'local-' + uuid,
    name,
    uuid,
    mode: 'offline',
    accessToken: '0',
    createdAt: Date.now()
  }
}