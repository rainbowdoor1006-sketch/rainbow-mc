import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { paths } from '../paths'
import { downloadAll, fetchJson } from './http'
import type { AppSettings } from '@shared/types'

/**
 * CurseForge 整合包支持。
 *
 * 背景：CurseForge 的整合包（manifest.json）里**只有 projectID / fileID**，
 * 没有文件名也没有下载地址。要下载必须先「按 ID 换直链」。
 *
 * 三条路（按优先级）：
 *   ① 第三方代理：GET {cfApiBase}/file?projectId=&fileId=
 *        → { ok:true, fileName, downloadUrl }
 *      （服务端持有 CurseForge API Key，用户零配置）
 *   ② 自备 Key：GET https://api.curseforge.com/v1/mods/{p}/files/{f}
 *        header: x-api-key
 *   ③ 都没有 → 返回失败原因，由调用方提示用户
 */

export const DEFAULT_CF_PROXY = 'https://rainbowdoor.icu/api/cf'

export interface CfFileRef {
  projectId: number
  fileId: number
}

export interface CfResolved {
  ok: boolean
  fileName?: string
  downloadUrl?: string
  message?: string
}

interface ProxyResp {
  ok?: boolean
  fileName?: string
  downloadUrl?: string
  message?: string
  error?: string
}

async function resolveViaProxy(base: string, ref: CfFileRef): Promise<CfResolved> {
  const url = `${base.replace(/\/$/, '')}/file?projectId=${ref.projectId}&fileId=${ref.fileId}`
  const data = await fetchJson<ProxyResp>(url)
  if (data?.ok && data.downloadUrl) {
    return { ok: true, fileName: data.fileName, downloadUrl: data.downloadUrl }
  }
  return { ok: false, message: data?.message || data?.error || '代理未返回下载地址' }
}

interface CfApiFile {
  fileName?: string
  downloadUrl?: string | null
}

async function resolveViaKey(apiKey: string, ref: CfFileRef): Promise<CfResolved> {
  const url = `https://api.curseforge.com/v1/mods/${ref.projectId}/files/${ref.fileId}`
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey, Accept: 'application/json', 'User-Agent': 'RAINBOWMC' }
  })
  if (!res.ok) return { ok: false, message: `CurseForge API HTTP ${res.status}` }
  const json = (await res.json()) as { data?: CfApiFile }
  const f = json.data
  if (!f?.downloadUrl) return { ok: false, message: '该文件不允许第三方下载（作者关闭了 API 下载）' }
  return { ok: true, fileName: f.fileName, downloadUrl: f.downloadUrl }
}

/** 把 projectID/fileID 解析成真实下载地址 */
export async function resolveCfFile(settings: AppSettings, ref: CfFileRef): Promise<CfResolved> {
  const proxy = (settings.cfApiBase ?? DEFAULT_CF_PROXY).trim()
  const key = (settings.curseforgeApiKey ?? '').trim()
  let last = ''

  // ① 免 Key 通道：cfwidget 查文件名 + mediafilez 拼直链（实测可用，用户零配置）
  try {
    const w = await resolveViaWidget(ref)
    if (w.ok) return w
    last = w.message || ''
  } catch (e) {
    last = e instanceof Error ? e.message : String(e)
  }

  // ② 自建/第三方代理（持有 Key）
  if (proxy) {
    try {
      const r = await resolveViaProxy(proxy, ref)
      if (r.ok) return r
      last = r.message || ''
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
  }
  if (key) {
    try {
      const r = await resolveViaKey(key, ref)
      if (r.ok) return r
      last = r.message || last
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
  }
  return {
    ok: false,
    message:
      last ||
      '没有可用的 CurseForge 下载通道（请在设置里配置代理地址，或填写自己的 CurseForge API Key）'
  }
}


/* ─────────── 免 Key 通道：cfwidget 查文件名 + forgecdn 拼直链 ─────────── */

interface WidgetFile {
  id: number
  name: string
  filesize?: number
  versions?: string[]
}
interface WidgetResp {
  id?: number
  files?: WidgetFile[]
}

const widgetCache = new Map<number, { at: number; files: WidgetFile[] }>()
const WIDGET_TTL = 6 * 60 * 60 * 1000

async function widgetFiles(projectId: number): Promise<WidgetFile[]> {
  const hit = widgetCache.get(projectId)
  if (hit && Date.now() - hit.at < WIDGET_TTL) return hit.files
  const data = await fetchJson<WidgetResp>(`https://api.cfwidget.com/${projectId}`)
  const files = data?.files ?? []
  if (files.length) widgetCache.set(projectId, { at: Date.now(), files })
  return files
}

/** 用 fileId + 文件名拼 CurseForge CDN 直链（mediafilez 是唯一能直链的域名） */
function cdnUrl(fileId: number, fileName: string): string {
  const a = Math.floor(fileId / 1000)
  const b = fileId % 1000
  return `https://mediafilez.forgecdn.net/files/${a}/${b}/${encodeURIComponent(fileName)}`
}

async function resolveViaWidget(ref: CfFileRef): Promise<CfResolved> {
  const files = await widgetFiles(ref.projectId)
  const f = files.find((x) => Number(x.id) === Number(ref.fileId))
  if (!f?.name) return { ok: false, message: 'cfwidget 里没有这个文件（可能太旧）' }
  return { ok: true, fileName: f.name, downloadUrl: cdnUrl(ref.fileId, f.name) }
}
export interface CfDownloadResult {
  ok: boolean
  downloaded: number
  failed: CfFileRef[]
  message?: string
}

/** 批量把 CurseForge 文件下到项目 mods 目录 */
export async function downloadCfFiles(
  settings: AppSettings,
  projectDir: string,
  files: CfFileRef[],
  onProgress?: (msg: string) => void,
  signal?: AbortSignal
): Promise<CfDownloadResult> {
  const modsDir = join(paths.games(), projectDir, 'mods')
  mkdirSync(modsDir, { recursive: true })

  const tasks: { url: string; dest: string }[] = []
  const failed: CfFileRef[] = []
  let i = 0
  for (const f of files) {
    if (signal?.aborted) break
    i++
    onProgress?.(`解析 CurseForge 文件 ${i}/${files.length}…`)
    const r = await resolveCfFile(settings, f)
    if (!r.ok || !r.downloadUrl) {
      failed.push(f)
      continue
    }
    const fileName = r.fileName || `${f.projectId}-${f.fileId}.jar`
    tasks.push({ url: r.downloadUrl, dest: join(modsDir, fileName.replace(/[\\/:*?"<>|]/g, '_')) })
  }

  let downloaded = 0
  if (tasks.length) {
    const pending = tasks.filter((t) => !existsSync(t.dest))
    if (pending.length) {
      onProgress?.(`下载 CurseForge 模组 0/${pending.length}…`)
      let done = 0
      for (let k = 0; k < pending.length; k += 8) {
        if (signal?.aborted) break
        await downloadAll(pending.slice(k, k + 8), { concurrency: 6, signal })
        done += Math.min(8, pending.length - k)
        onProgress?.(`下载 CurseForge 模组 ${done}/${pending.length}…`)
      }
      downloaded = pending.length
    }
  }

  return {
    ok: failed.length === 0,
    downloaded,
    failed,
    message: failed.length
      ? `${failed.length} 个 CurseForge 文件没法下载（作者关闭了 API 下载，或代理/Key 无效）`
      : undefined
  }
}
