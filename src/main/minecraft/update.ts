import { app } from 'electron'
import { createPublicKey, verify } from 'crypto'
import { fetchJson } from './http'

export interface UpdateInfo {
  version: string
  url: string
  notes?: string
  mandatory?: boolean
  /** 安装包大小（字节），参与签名 */
  size?: number
  /** 安装包 sha256（小写），参与签名 */
  sha256?: string
  /** 清单签名（base64，Ed25519），对 version/sha256/size/url 计算 */
  sig?: string
  /** 安装包下载地址（没有时回落到 url） */
  downloadUrl?: string
}

export interface UpdateResult {
  ok: boolean
  hasUpdate: boolean
  current: string
  latest?: UpdateInfo
  message?: string
}


/**
 * 更新清单签名校验（Ed25519）。
 *
 * 为什么需要：清单和安装包同源，sha256 也来自同一响应，服务器被拿下就能给所有用户
 * 推任意安装包并静默执行。改成「公钥内置在程序里」后，攻击者必须同时拿到私钥才能伪造，
 * 服务器被拿下也推不了恶意包。
 *
 * 清单里必须带 sig 字段：
 *   sig = base64( Ed25519( "version\nsha256\nsize\nurl" ) )
 */
const UPDATE_PUBKEY = '6lzLX0k8R9KnKfDHJN64UDnECIbNCL7/4zDafvj7HqE='

function canonical(info: { version?: string; sha256?: string; size?: number; url?: string; downloadUrl?: string }): string {
  return [info.version ?? '', info.sha256 ?? '', String(info.size ?? 0), info.downloadUrl ?? info.url ?? ''].join('\n')
}

/** 校验清单签名；返回 null 表示通过，否则返回失败原因 */
export function verifyManifest(info: {
  version?: string
  sha256?: string
  size?: number
  url?: string
  downloadUrl?: string
  sig?: string
}): string | null {
  if (!info?.sig) return '更新清单未签名（服务器可能还是旧版本，或清单被人改过）'
  if (!info.version || !info.sha256) return '更新清单缺少 version / sha256'
  try {
    const raw = Buffer.from(UPDATE_PUBKEY, 'base64')
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' })
    const ok = verify(null, Buffer.from(canonical(info), 'utf8'), key, Buffer.from(info.sig, 'base64'))
    return ok ? null : '更新清单签名校验失败（可能被篡改）'
  } catch (e) {
    return '更新清单签名校验异常：' + (e instanceof Error ? e.message : String(e))
  }
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
    const info = await fetchJson<UpdateInfo & { sig?: string; sha256?: string; size?: number; downloadUrl?: string }>(
      manifestUrl,
      2
    )
    if (!info?.version) return { ok: false, hasUpdate: false, current, message: '清单格式不正确' }
    // 先验签，再信任清单里的任何字段
    const sigErr = verifyManifest(info)
    if (sigErr) return { ok: false, hasUpdate: false, current, message: sigErr }
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
