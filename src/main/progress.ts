import type { BrowserWindow } from 'electron'

export interface DlTask {
  id: string
  label: string
  kind: 'version' | 'mod' | 'java' | 'loader' | 'asset' | 'lib' | 'other'
  /** 0-100 */
  pct: number
  /** 当前速度（字节/秒） */
  speed: number
  loaded: number
  total: number
  startedAt: number
}

const tasks = new Map<string, DlTask>()
let windowGetter: (() => BrowserWindow | null) | null = null
let timer: NodeJS.Timeout | null = null
let last = { loaded: 0, at: 0 }

export function initProgress(getWin: () => BrowserWindow | null): void {
  windowGetter = getWin
}

function flush(force = false): void {
  if (!windowGetter) return
  const win = windowGetter()
  if (!win || win.isDestroyed()) return
  if (!force && timer) return
  const list = [...tasks.values()]
  win.webContents.send('dl:tasks', list)
  if (force || !list.length) {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

function ensureTimer(): void {
  if (timer) return
  timer = setInterval(() => flush(true), 400)
}

export function startTask(id: string, label: string, kind: DlTask['kind'], total = 0): void {
  tasks.set(id, { id, label, kind, pct: 0, speed: 0, loaded: 0, total, startedAt: Date.now() })
  ensureTimer()
  flush(true)
}

export function updateTask(id: string, patch: Partial<Pick<DlTask, 'pct' | 'loaded' | 'total' | 'label'>>): void {
  const t = tasks.get(id)
  if (!t) return
  if (patch.label !== undefined) t.label = patch.label
  if (patch.total !== undefined) t.total = patch.total
  if (patch.loaded !== undefined) t.loaded = patch.loaded
  if (patch.pct !== undefined) t.pct = Math.max(0, Math.min(100, patch.pct))
  else if (t.total > 0) t.pct = Math.max(0, Math.min(100, Math.round((t.loaded / t.total) * 100)))
  const now = Date.now()
  if (last.at && now - last.at > 250) {
    const dt = (now - last.at) / 1000
    t.speed = Math.max(0, (t.loaded - last.loaded) / dt)
    last = { loaded: t.loaded, at: now }
  } else if (!last.at) {
    last = { loaded: t.loaded, at: now }
  }
}

export function finishTask(id: string, label?: string): void {
  const t = tasks.get(id)
  if (!t) return
  t.pct = 100
  if (label) t.label = label
  setTimeout(() => {
    tasks.delete(id)
    flush(true)
  }, 700)
}

export function snapshot(): DlTask[] {
  return [...tasks.values()]
}
