import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'fs'
import { createHash } from 'crypto'
import { dirname } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { app } from 'electron'
import { Transform } from 'stream'

const UA = 'RAINBOWMC-Launcher/0.1.0'

export async function fetchJson<T>(url: string, retries = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(30000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return (await res.json()) as T
    } catch (e) {
      lastErr = e
      await sleep(600 * (i + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function fetchText(url: string, retries = 3): Promise<string> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(30000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return await res.text()
    } catch (e) {
      lastErr = e
      await sleep(600 * (i + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function sha1File(path: string): string | null {
  try {
    const h = createHash('sha1')
    h.update(require('fs').readFileSync(path))
    return h.digest('hex')
  } catch {
    return null
  }
}

export function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

export interface DownloadTask {
  /** 下载进度回调：已下载字节 / 总字节（总字节为 0 表示未知） */
  onBytes?: (loaded: number, total: number) => void
  /** 外部取消信号：abort 后立刻中断当前下载 */
  signal?: AbortSignal
  /** 备用下载地址：主地址失败时依次尝试 */
  altUrls?: string[]
  url: string
  dest: string
  sha1?: string
  size?: number
}

export interface DownloadResult {
  ok: boolean
  skipped: boolean
  bytes: number
  error?: string
}

/** 分段多线程下载：把大文件切成 N 段并行拉取，最后拼接 + 校验 sha1 */
async function downloadSegmented(
  task: DownloadTask,
  urls: string[],
  segs: number
): Promise<DownloadResult | null> {
  const size = task.size || 0
  if (!size || segs < 2) return null
  const partSize = Math.ceil(size / segs)
  const parts: string[] = []
  let loadedTotal = 0
  let lastEmit = 0
  try {
    await Promise.all(
      Array.from({ length: segs }, async (_v, i) => {
        const start = i * partSize
        const end = Math.min(size, start + partSize) - 1
        if (start > end) return
        const tmp = `${task.dest}.seg${i}`
        parts.push(tmp)
        if (task.signal?.aborted) throw new Error('aborted')
        const url = urls[i % urls.length]
        const sig = task.signal
          ? AbortSignal.any([AbortSignal.timeout(600000), task.signal])
          : AbortSignal.timeout(600000)
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, Range: `bytes=${start}-${end}` },
          signal: sig
        })
        if (res.status !== 206 || !res.body) throw new Error(`分段不支持（HTTP ${res.status}）`)
        const counter = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            loadedTotal += chunk.length
            const now = Date.now()
            if (task.onBytes && now - lastEmit > 200) {
              lastEmit = now
              task.onBytes(loadedTotal, size)
            }
            cb(null, chunk)
          }
        })
        await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(tmp))
      })
    )
    // 按顺序拼接
    const fd = openSync(task.dest + '.part', 'w')
    try {
      for (const p of parts.sort((a, b) => Number(a.split('.seg')[1]) - Number(b.split('.seg')[1]))) {
        if (!existsSync(p)) continue
        writeSync(fd, readFileSync(p))
        unlinkSync(p)
      }
    } finally {
      closeSync(fd)
    }
    if (task.sha1 && sha1File(task.dest + '.part') !== task.sha1) {
      throw new Error('sha1 mismatch')
    }
    renameSync(task.dest + '.part', task.dest)
    task.onBytes?.(size, size)
    return { ok: true, skipped: false, bytes: size }
  } catch (e) {
    for (const p of parts) {
      try {
        if (existsSync(p)) unlinkSync(p)
      } catch {
        /* ignore */
      }
    }
    try {
      if (existsSync(task.dest + '.part')) unlinkSync(task.dest + '.part')
    } catch {
      /* ignore */
    }
    return null
  }
}
/** 单文件下载：已存在且 sha1 匹配则跳过；断点不续传，失败整体重试 3 次 */
export async function downloadOne(task: DownloadTask, retries = 3): Promise<DownloadResult> {
  ensureDir(dirname(task.dest))

  if (existsSync(task.dest) && task.size && fileSize(task.dest) === task.size) {
    if (!task.sha1) return { ok: true, skipped: true, bytes: 0 }
    if (sha1File(task.dest) === task.sha1) return { ok: true, skipped: true, bytes: 0 }
  }

  let lastErr = ''
  const urls = [task.url, ...(task.altUrls ?? [])]

  // 大文件走分段多线程（≥32MB，实测 4 连接能到单连接 2.4 倍），失败自动回退单线程
  if ((task.size || 0) >= 32 * 1024 * 1024) {
    const seg = await downloadSegmented(task, urls, 4)
    if (seg) return seg
  }

  for (let i = 0; i < retries; i++) {
    const tmp = task.dest + '.part'
    try {
      const target = urls[i % urls.length]
      const sig = task.signal
        ? AbortSignal.any([AbortSignal.timeout(120000), task.signal])
        : AbortSignal.timeout(120000)
      const res = await fetch(target, { headers: { 'User-Agent': UA }, signal: sig })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length') || task.size || 0)
      let loaded = 0
      let lastEmit = 0
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          loaded += chunk.length
          const now = Date.now()
          if (task.onBytes && now - lastEmit > 200) {
            lastEmit = now
            task.onBytes(loaded, total)
          }
          cb(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(tmp))
      task.onBytes?.(loaded, total || loaded)
      if (task.sha1 && sha1File(tmp) !== task.sha1) throw new Error('sha1 mismatch')
      renameSync(tmp, task.dest)
      return { ok: true, skipped: false, bytes: fileSize(task.dest) }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      await sleep(500 * (i + 1))
    }
  }
  return { ok: false, skipped: false, bytes: 0, error: lastErr }
}

export interface PoolOptions {
  /** 整批下载共用取消信号 */
  signal?: AbortSignal
  concurrency?: number
  onProgress?: (done: number, total: number, bytes: number) => void
  onError?: (task: DownloadTask, error: string) => void
}

/** 并发下载一批任务，返回失败列表 */
export async function downloadAll(tasks: DownloadTask[], opts: PoolOptions = {}): Promise<DownloadTask[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 16)
  const failed: DownloadTask[] = []
  let done = 0
  let bytes = 0
  let index = 0

  const worker = async (): Promise<void> => {
    while (index < tasks.length) {
      if (opts.signal?.aborted) return
      const task: DownloadTask = opts.signal ? { ...tasks[index++], signal: opts.signal } : tasks[index++]
      const r = await downloadOne(task)
      done++
      if (!r.ok) {
        failed.push(task)
        opts.onError?.(task, r.error || 'unknown')
      } else {
        bytes += r.bytes
      }
      opts.onProgress?.(done, tasks.length, bytes)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return failed
}

export const appDataPath = app.getPath('appData')
