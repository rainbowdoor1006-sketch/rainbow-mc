import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'
import { paths } from '../paths'

export interface LogMeta {
  runId: string
  startedAt: number
  projectId: string
  projectName: string
  version: string
  loader: string
  account: string
  loginMode: string
  exitCode?: number
  /** 归一化后的退出码：Windows 的 4294967295 → -1 */
  exitCodeSigned?: number
  /** 结束原因：user=用户在启动器里结束，exit=正常退出，crash=异常退出 */
  stopReason?: 'user' | 'exit' | 'crash'
  errorCode?: string
  message?: string
  durationMs?: number
}

export function newRunId(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function runLogPath(runId: string): string {
  mkdirSync(paths.logs(), { recursive: true })
  return join(paths.logs(), `run-${runId}.log`)
}

/** 把一次启动的日志 + 元数据打包成 ZIP，返回 zip 路径 */
export function packLog(runId: string, meta: LogMeta, logFile: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AdmZip = require('adm-zip') as typeof import('adm-zip')
  const zip = new AdmZip()
  if (existsSync(logFile)) zip.addLocalFile(logFile, '', `run-${runId}.log`)
  zip.addFile(
    'meta.json',
    Buffer.from(
      JSON.stringify(
        {
          launcher: 'RAINBOW MC',
          launcherVersion: app.getVersion(),
          ...meta,
          runId
        },
        null,
        2
      ),
      'utf8'
    )
  )
  const out = join(paths.logs(), `RAINBOWMC-${runId}.zip`)
  zip.writeZip(out)
  return out
}

export interface LogEntry {
  name: string
  path: string
  size: number
  mtime: number
}

export function listLogs(): LogEntry[] {
  const dir = paths.logs()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith('.zip'))
    .map((n) => {
      const p = join(dir, n)
      return { name: n, path: p, size: statSync(p).size, mtime: statSync(p).mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

export function writeMeta(runId: string, meta: LogMeta): void {
  mkdirSync(paths.logs(), { recursive: true })
  writeFileSync(join(paths.logs(), `meta-${runId}.json`), JSON.stringify(meta, null, 2), 'utf-8')
}
