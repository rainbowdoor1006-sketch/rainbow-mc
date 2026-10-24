import { app } from 'electron'
import { fetchJson } from './http'

export interface UpdateInfo {
  version: string
  url: string
  notes?: string
  mandatory?: boolean
}

export interface UpdateResult {
  ok: boolean
  hasUpdate: boolean
  current: string
  latest?: UpdateInfo
  message?: string
}

function parseVer(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((s) => parseInt(s.replace(/\D/g, ''), 10) || 0)
}

/** 语义化版本比较：a > b 返回 1 */
export function compareVersion(a: string, b: string): number {
  const pa = parseVer(a)
  const pb = parseVer(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/**
 * 检查更新。清单格式：
 * { "version": "0.2.0", "url": "https://...", "notes": "...", "mandatory": false }
 */
export async function checkForUpdate(manifestUrl: string): Promise<UpdateResult> {
  const current = app.getVersion()
  if (!manifestUrl) return { ok: false, hasUpdate: false, current, message: '未配置更新清单地址' }
  try {
    const info = await fetchJson<UpdateInfo>(manifestUrl, 2)
    if (!info?.version) return { ok: false, hasUpdate: false, current, message: '清单格式不正确' }
    return {
      ok: true,
      hasUpdate: compareVersion(info.version, current) > 0,
      current,
      latest: info
    }
  } catch (e) {
    return {
      ok: false,
      hasUpdate: false,
      current,
      message: e instanceof Error ? e.message : String(e)
    }
  }
}
