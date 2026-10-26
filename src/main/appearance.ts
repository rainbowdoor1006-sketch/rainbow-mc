import { BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { paths } from './paths'
import { persist, state, updateSettings } from './store'
import type { AppearanceSettings } from '@shared/types'

const BG_NAME = 'custom-bg.png'

let winGetter: (() => BrowserWindow | null) | null = null

export function initAppearance(getWin: () => BrowserWindow | null): void {
  winGetter = getWin
}
const MAX_INPUT = 30 * 1024 * 1024

/** 自定义协议：让渲染进程能安全加载本地图片（dev 的 http 页面也能用） */
export function registerAppearanceProtocol(): void {
protocol.handle('rainbow', (request) => {
  try {
    const url = new URL(request.url)
    const raw = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const path = require('path') as typeof import('path')
    const fs = require('fs') as typeof import('fs')
    const root = path.resolve(paths.root())
    // 关键：先 resolve 再判断，否则 data\\..\\.. 这种字符串仍以 data 开头，能绕过前缀检查
    const resolved = path.resolve(raw)
    const insideRoot = resolved === root || resolved.startsWith(root + path.sep)
    // 允许 data 之外的「用户显式选择」的文件：自定义背景、账号头像
    const allowed = new Set<string>()
    const st = state()
    const bg = st.settings.appearance?.backgroundFile
    if (bg) allowed.add(path.resolve(bg))
    for (const acc of st.accounts) if (acc.avatar) allowed.add(path.resolve(acc.avatar))
    if (!insideRoot && !allowed.has(resolved)) {
      return new Response('forbidden', { status: 403 })
    }
    if (!fs.existsSync(resolved)) return new Response('not found', { status: 404 })
    const buf = fs.readFileSync(resolved)
    const ext = resolved.split('.').pop()?.toLowerCase() || 'png'
    const mime =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'bmp'
            ? 'image/bmp'
            : 'image/png'
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' }
    })
  } catch {
    return new Response('bad request', { status: 400 })
  }
})
}

function bgPath(): string {
  return join(paths.backgrounds(), BG_NAME)
}

export function backgroundUrl(): string {
  const f = state().settings.appearance?.backgroundFile
  if (!f || !existsSync(f)) return ''
  return 'rainbow://local/' + encodeURIComponent(f)
}

export function registerAppearanceIpc(): void {
  /** 选图：返回 dataURL 给界面做裁剪预览 */
  ipcMain.handle('appearance:pickImage', async () => {
    // 必须把父窗口传进去：无主对话框在 Windows 上会被启动器窗口压住，
    // 表现就是「点了选图，弹窗跑到启动器后面去了」。
    const parent = winGetter?.() ?? null
    const opts = {
      title: '选择图片',
      properties: ['openFile' as const],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    }
    const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    const file = r.filePaths[0]
    try {
      const buf = readFileSync(file)
      if (buf.length > MAX_INPUT) return { ok: false, message: '图片太大了（上限 30 MB）' }
      const ext = file.split('.').pop()?.toLowerCase() || 'png'
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'bmp' ? 'image/bmp' : 'image/png'
      return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, name: file.split(/[\\/]/).pop() }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 裁剪后保存：dataURL → 落盘 → 写进设置 */
  ipcMain.handle('appearance:saveBackground', async (_e, payload: { dataUrl: string }) => {
    const dataUrl = payload?.dataUrl || ''
    const m = /^data:image\/\w+;base64,(.+)$/i.exec(dataUrl)
    if (!m) return { ok: false, message: '图片数据无效' }
    try {
      const buf = Buffer.from(m[1], 'base64')
      const target = bgPath()
      writeFileSync(target, buf)
      // 换新图时清掉旧文件（如果路径不同）
      const old = state().settings.appearance?.backgroundFile
      if (old && old !== target && existsSync(old) && old.includes('RAINBOWMC')) {
        try {
          unlinkSync(old)
        } catch {
          /* ignore */
        }
      }
      updateSettings({
        appearance: {
          ...(state().settings.appearance as AppearanceSettings),
          // 关键：必须切到 image 模式，否则 preset/default 会盖掉这张图
          backgroundMode: 'image' as const,
          backgroundFile: target
        }
      })
      persist()
      return { ok: true, url: backgroundUrl() }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 恢复默认背景 */
  ipcMain.handle('appearance:resetBackground', () => {
    const old = state().settings.appearance?.backgroundFile
    if (old && existsSync(old)) {
      try {
        unlinkSync(old)
      } catch {
        /* ignore */
      }
    }
    updateSettings({
      appearance: { ...(state().settings.appearance as AppearanceSettings), backgroundFile: '' }
    })
    persist()
    return { ok: true }
  })

  /** 切到官方预设壁纸 */
  ipcMain.handle('appearance:setPreset', () => {
    const cur = state().settings.appearance as AppearanceSettings
    updateSettings({
      appearance: {
        ...cur,
        backgroundMode: 'preset' as const,
        // 预设壁纸本身偏亮，压暗值调低一点才好看
        backgroundDim: Math.min(cur.backgroundDim ?? 28, 28)
      }
    })
    persist()
    return { ok: true }
  })

  /** 切回默认背景 */
  ipcMain.handle('appearance:setDefault', () => {
    updateSettings({
      appearance: { ...(state().settings.appearance as AppearanceSettings), backgroundMode: 'default' as const }
    })
    persist()
    return { ok: true }
  })
  /** 材质 / 主色 / 压暗程度 */
  ipcMain.handle('appearance:update', (_e, patch: Partial<AppearanceSettings>) => {
    updateSettings({ appearance: { ...(state().settings.appearance as AppearanceSettings), ...patch } })
    persist()
    return { ok: true, url: backgroundUrl() }
  })
}
