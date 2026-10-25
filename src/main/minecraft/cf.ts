import { join } from 'path'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'fs'
import { paths } from '../paths'
import { fetchJson } from './http'
import type { AppSettings } from '@shared/types'

/**
 * CurseForge 整合包支持。
 *
 * 背景：CurseForge 的整合包（manifest.json）里**只有 projectID / fileID**，
 * 没有文件名也没有下载地址。要下载必须先「按 ID 换直链」。
 *
 * 三条路（按优先级）：
 *   ① 免 Key 通道：api.cfwidget.com 查文件名 → mediafilez.forgecdn.net 拼直链
 *   ② 自建代理：GET {cfApiBase}/file?projectId=&fileId=
 *   ③ 自备 Key：GET https://api.curseforge.com/v1/mods/{p}/files/{f}
 */

export const DEFAULT_CF_PROXY = ''

export interface CfFileRef {
  projectId: number
  fileId: number
}

export interface CfResolved {
  ok: boolean
  fileName?: string
  downloadUrl?: string
  size?: number
  message?: string
}

interface ProxyResp {
  ok?: boolean
  fileName?: string
  downloadUrl?: string
  size?: number
  message?: string
  error?: string
}

async function resolveViaProxy(base: string, ref: CfFileRef): Promise<CfResolved> {
  const url = `${base.replace(/\/$/, '')}/file?projectId=${ref.projectId}&fileId=${ref.fileId}`
  const data = await fetchJson<ProxyResp>(url)
  if (data?.ok && data.downloadUrl) {
    return { ok: true, fileName: data.fileName, downloadUrl: data.downloadUrl, size: data.size }
  }
  return { ok: false, message: data?.message || data?.error || '代理未返回下载地址' }
}

interface CfApiFile {
  fileName?: string
  downloadUrl?: string | null
  fileLength?: number
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
  return { ok: true, fileName: f.fileName, downloadUrl: f.downloadUrl, size: f.fileLength }
}

/* ─────────── 免 Key 通道：cfwidget 查文件名 + forgecdn 拼直链 ─────────── */

interface WidgetFile {
  id: number
  name: string
  filesize?: number
}
interface WidgetResp {
  id?: number
  files?: WidgetFile[]
}

const WIDGET_TTL = 7 * 24 * 60 * 60 * 1000 // 文件 ID → 文件名不会变，缓存一周
const widgetMem = new Map<number, WidgetFile[]>()
const widgetInflight = new Map<number, Promise<WidgetFile[]>>()

function widgetCacheFile(projectId: number): string {
  return join(paths.root(), 'cache', 'cfwidget', `${projectId}.json`)
}

function readWidgetCache(projectId: number): WidgetFile[] | null {
  try {
    const f = widgetCacheFile(projectId)
    if (!existsSync(f)) return null
    const j = JSON.parse(readFileSync(f, 'utf-8')) as { at: number; files: WidgetFile[] }
    if (!j?.files?.length) return null
    if (Date.now() - j.at > WIDGET_TTL) return null
    return j.files
  } catch {
    return null
  }
}

function writeWidgetCache(projectId: number, files: WidgetFile[]): void {
  try {
    const f = widgetCacheFile(projectId)
    mkdirSync(join(paths.root(), 'cache', 'cfwidget'), { recursive: true })
    writeFileSync(f, JSON.stringify({ at: Date.now(), files }), 'utf-8')
  } catch {
    /* 缓存失败不影响功能 */
  }
}

async function widgetFiles(projectId: number): Promise<WidgetFile[]> {
  const mem = widgetMem.get(projectId)
  if (mem) return mem
  const disk = readWidgetCache(projectId)
  if (disk) {
    widgetMem.set(projectId, disk)
    return disk
  }
  const inflight = widgetInflight.get(projectId)
  if (inflight) return inflight
  const p = (async () => {
    try {
      const data = await fetchJson<WidgetResp>(`https://api.cfwidget.com/${projectId}`)
      const files = data?.files ?? []
      if (files.length) {
        widgetMem.set(projectId, files)
        writeWidgetCache(projectId, files)
      }
      return files
    } finally {
      widgetInflight.delete(projectId)
    }
  })()
  widgetInflight.set(projectId, p)
  return p
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
  return { ok: true, fileName: f.name, downloadUrl: cdnUrl(ref.fileId, f.name), size: f.filesize }
}

/** 把 projectID/fileID 解析成真实下载地址 */
export async function resolveCfFile(settings: AppSettings, ref: CfFileRef): Promise<CfResolved> {
  const proxy = (settings.cfApiBase ?? DEFAULT_CF_PROXY).trim()
  const key = (settings.curseforgeApiKey ?? '').trim()
  let last = ''

  // ① 免 Key 通道
  try {
    const w = await resolveViaWidget(ref)
    if (w.ok) return w
    last = w.message || ''
  } catch (e) {
    last = e instanceof Error ? e.message : String(e)
  }

  // ② 代理
  if (proxy) {
    try {
      const r = await resolveViaProxy(proxy, ref)
      if (r.ok) return r
      last = r.message || last
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
  }

  // ③ 自备 Key
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
      last || '没有可用的 CurseForge 下载通道（请在设置里配置代理地址，或填写自己的 CurseForge API Key）'
  }
}

/* ─────────── 下载：解析与下载流水线并行 ─────────── */


/** 去掉文件名的非法字符与 Minecraft 格式码（§l 之类），避免出现怪名字 */
function sanitizeName(raw: string): string {
  return raw
    .replace(/\u00a7./g, '') // §x 格式码
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
}

/** 按扩展名决定放哪个目录：jar → mods；shader → shaderpacks；其它 zip → resourcepacks */
function targetDirFor(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.jar') || lower.endsWith('.jar.disabled')) return join(paths.games(), projectDirRef, 'mods')
  if (lower.includes('shader')) return join(paths.games(), projectDirRef, 'shaderpacks')
  if (lower.endsWith('.zip')) return join(paths.games(), projectDirRef, 'resourcepacks')
  return join(paths.games(), projectDirRef, 'mods')
}

let projectDirRef = ''

export interface CfDownloadResult {
  ok: boolean
  downloaded: number
  failed: CfFileRef[]
  bytes: number
  message?: string
}

interface DlTask {
  url: string
  dest: string
  size?: number
  ref: CfFileRef
}

/** 校验是不是有效 jar（PK 头），防止把 HTML 错误页写成 .jar */
function looksLikeJar(p: string): boolean {
  try {
    const fd = openSync(p, 'r')
    const buf = Buffer.alloc(2)
    const n = readSync(fd, buf, 0, 2, 0)
    closeSync(fd)
    return n === 2 && buf[0] === 0x50 && buf[1] === 0x4b
  } catch {
    return false
  }
}

/** 单文件下载（流式读取 + 大小校验 + 一次重试） */
async function downloadOne(task: DlTask, signal?: AbortSignal): Promise<{ ok: boolean; bytes: number }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (signal?.aborted) return { ok: false, bytes: 0 }
      const res = await fetch(task.url, { signal, redirect: 'follow' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const chunks: Buffer[] = []
      let got = 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk))
        got += chunk.length
      }
      if (task.size && Math.abs(got - task.size) > 16) throw new Error('大小不符')
      mkdirSync(join(task.dest, '..'), { recursive: true })
      writeFileSync(task.dest, Buffer.concat(chunks))
      if (!looksLikeJar(task.dest)) throw new Error('不是有效的 jar')
      return { ok: true, bytes: got }
    } catch {
      if (attempt === 1) return { ok: false, bytes: 0 }
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  return { ok: false, bytes: 0 }
}

/**
 * 批量把 CurseForge 文件下到项目 mods 目录。
 * 关键优化：解析（慢、网络往返多）与下载（吃带宽）**同时进行**，不等全部解析完再下载。
 */
export async function downloadCfFiles(
  settings: AppSettings,
  projectDir: string,
  files: CfFileRef[],
  onProgress?: (msg: string) => void,
  signal?: AbortSignal
): Promise<CfDownloadResult> {
  projectDirRef = projectDir
  const modsDir = join(paths.games(), projectDir, 'mods')
  mkdirSync(modsDir, { recursive: true })
  mkdirSync(join(paths.games(), projectDir, 'shaderpacks'), { recursive: true })
  mkdirSync(join(paths.games(), projectDir, 'resourcepacks'), { recursive: true })

  const total = files.length
  const t0 = Date.now()
  const CONC_RESOLVE = 16
  const CONC_DL = 24

  const failed: CfFileRef[] = []
  let resolvedCount = 0
  let downloaded = 0
  let bytes = 0

  const queue: DlTask[] = []
  let producersDone = false
  const waiters: (() => void)[] = []
  const push = (t: DlTask): void => {
    queue.push(t)
    const w = waiters.shift()
    if (w) w()
  }
  const finishProducers = (): void => {
    producersDone = true
    for (const w of waiters.splice(0)) w()
  }
  const nextTask = async (): Promise<DlTask | null> => {
    for (;;) {
      if (queue.length) return queue.shift() as DlTask
      if (producersDone) return null
      await new Promise<void>((r) => waiters.push(r))
    }
  }

  const report = (force = false): void => {
    if (!force && (resolvedCount + downloaded) % 10 !== 0) return
    const sec = (Date.now() - t0) / 1000
    const speed = sec > 0 ? bytes / 1048576 / sec : 0
    onProgress?.(
      `解析 ${Math.min(resolvedCount, total)}/${total} · 已下载 ${downloaded} 个（${(bytes / 1048576).toFixed(0)} MB，${speed.toFixed(1)} MB/s）`
    )
  }

  // 解析工人：把 fileID 换成直链，成功就丢进队列
  let cursor = 0
  const resolveWorker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return
      const i = cursor++
      if (i >= total) return
      const f = files[i]
      const r = await resolveCfFile(settings, f)
      if (!r.ok || !r.downloadUrl) {
        failed.push(f)
        resolvedCount++
        report()
        continue
      }
      const name = sanitizeName(r.fileName || `${f.projectId}-${f.fileId}.jar`)
      const dest = join(targetDirFor(name), name)
      let already = false
      try {
        if (existsSync(dest)) {
          const sz = statSync(dest).size
          already = (!r.size || Math.abs(sz - r.size) <= 16) && looksLikeJar(dest)
        }
      } catch {
        /* ignore */
      }
      resolvedCount++
      if (already) {
        downloaded++
        bytes += r.size ?? 0
        report()
      } else {
        push({ url: r.downloadUrl, dest, size: r.size, ref: f })
      }
    }
  }

  // 下载工人：从队列取任务，边解析边下载
  const dlWorker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return
      const task = await nextTask()
      if (!task) return
      const res = await downloadOne(task, signal)
      if (res.ok) {
        downloaded++
        bytes += res.bytes
      } else {
        failed.push(task.ref)
      }
      report()
    }
  }

  onProgress?.(`开始解析并下载 ${total} 个文件（下载并发 ${CONC_DL}）…`)
  const resolvers = Array.from({ length: Math.min(CONC_RESOLVE, total) }, () => resolveWorker())
  const downloaders = Array.from({ length: Math.min(CONC_DL, total) }, () => dlWorker())

  // 解析全部结束后，通知下载工人可以收工
  void Promise.all(resolvers).then(finishProducers)
  await Promise.all(downloaders)

  const sec = (Date.now() - t0) / 1000
  const speed = sec > 0 ? bytes / 1048576 / sec : 0
  report(true)
  return {
    ok: failed.length === 0,
    downloaded,
    failed,
    bytes,
    message:
      failed.length > 0
        ? `${failed.length} 个文件未完成（下载失败或作者关闭了下载）；用时 ${sec.toFixed(0)}s，平均 ${speed.toFixed(1)} MB/s`
        : undefined
  }
}
