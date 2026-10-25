import { Tray, Menu, nativeImage, app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { processMemoryMb } from './feedback'
import { paths } from '../paths'

/**
 * 托盘：游戏运行后在托盘显示「已运行时长 / 内存占用」。
 * 图标用内置的 16×16 玉青色方块，避免依赖打包资源路径。
 */

interface RunningInfo {
  pid: number
  projectId: string
  projectName: string
  since: number
}

let tray: Tray | null = null
let timer: NodeJS.Timeout | null = null
let getRunning: (() => RunningInfo | null) | null = null
let stopGame: (() => void) | null = null
let showWindow: (() => void) | null = null

/** 16×16 玉青方块，RGBA base64（无外部依赖） */
function makeIcon(): Electron.NativeImage {
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // 圆角方块 + 中心亮一点
      const edge = x < 2 || y < 2 || x > size - 3 || y > size - 3
      buf[i] = edge ? 0x5f : 0x7f
      buf[i + 1] = edge ? 0x9b : 0xb6
      buf[i + 2] = edge ? 0x80 : 0x9b
      buf[i + 3] = 255
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分`
  if (m > 0) return `${m} 分 ${s % 60} 秒`
  return `${s} 秒`
}

function refresh(): void {
  if (!tray || !getRunning) return
  const info = getRunning()
  if (!info) {
    tray.setToolTip('RAINBOW MC · 未在运行')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => showWindow?.() },
        { type: 'separator' },
        { label: '退出 RAINBOW MC', click: () => app.quit() }
      ])
    )
    return
  }
  const memMb = processMemoryMb(info.pid)
  const elapsed = fmtElapsed(Date.now() - info.since)
  const memText = memMb > 0 ? `${(memMb / 1024).toFixed(1)} GB` : '读取中'
  tray.setToolTip(`RAINBOW MC\n${info.projectName} · 已运行 ${elapsed}\n内存 ${memText}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `${info.projectName} · ${elapsed} · ${memText}`, enabled: false },
      { type: 'separator' },
      { label: '显示主窗口', click: () => showWindow?.() },
      { label: '停止游戏', click: () => stopGame?.() },
      { label: '打开日志目录', click: () => void shell.openPath(join(paths.root(), 'logs')) },
      { type: 'separator' },
      { label: '退出 RAINBOW MC', click: () => app.quit() }
    ])
  )
}

export function initTray(opts: {
  getRunning: () => RunningInfo | null
  stopGame: () => void
  showWindow: () => void
}): void {
  if (tray) return
  try {
    getRunning = opts.getRunning
    stopGame = opts.stopGame
    showWindow = opts.showWindow
    tray = new Tray(makeIcon())
    tray.on('click', () => opts.showWindow())
    refresh()
    timer = setInterval(refresh, 10_000)
  } catch {
    /* 托盘创建失败不影响启动器 */
  }
}

export function disposeTray(): void {
  if (timer) clearInterval(timer)
  timer = null
  try {
    tray?.destroy()
  } catch {
    /* ignore */
  }
  tray = null
}
