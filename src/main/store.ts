import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'
import { paths } from './paths'
import type { AppSettings, AppState, GameProject, AccountInfo } from '@shared/types'

const DEFAULT_SETTINGS: AppSettings = {
  locale: 'zh-CN',
  region: 'CN',
  regionChosen: false,
  regionNoticeAccepted: false,
  downloadSource: 'official',
  updateManifestUrl: '',
  forgeEarlyWindow: false,
  cfApiBase: '',
  curseforgeApiKey: '',
  autoCheckUpdate: true,
  updateChannel: 'stable',
  skippedVersion: '',
  maxMemoryMb: 4096,
  javaPath: '',
  autoJava: true,
  gameDirs: [],
  windowTitle: 'Minecraft',
  appearance: {
    backgroundMode: 'default',
    backgroundFile: '',
    backgroundDim: 45,
    material: 'dark',
    accent: '#7fb69b'
  }
}

function emptyState(): AppState {
  return { settings: { ...DEFAULT_SETTINGS }, accounts: [], projects: [] }
}

let cache: AppState | null = null

/** 把配置里残留的旧数据根路径改成当前数据根；顺带修复头像来源 */
function fixStalePaths(s: Partial<AppState>): void {
  const root = paths.root()
  const legacy = join(app.getPath('appData'), 'RAINBOWMC')
  const rewrite = (p?: string): string | undefined =>
    p && p.toLowerCase().startsWith(legacy.toLowerCase())
      ? join(root, p.slice(legacy.length).replace(/^[\\/]+/, ''))
      : p
  if (root.toLowerCase() !== legacy.toLowerCase()) {
    const ap = s.settings?.appearance
    if (ap?.backgroundFile) ap.backgroundFile = rewrite(ap.backgroundFile) ?? ap.backgroundFile
  }
  for (const a of s.accounts ?? []) {
    if (!a.avatar) continue
    const fixed = rewrite(a.avatar)
    if (fixed) a.avatar = fixed
    // 头像是远程地址、但本地有自定义头像文件 → 优先本地（自定义头像不能被覆盖）
    if (/^https?:/i.test(a.avatar)) {
      const local = join(root, 'avatars', `${a.id}.png`)
      if (existsSync(local)) a.avatar = local
    }
  }
}
export function state(): AppState {
  if (cache) return cache
  try {
    if (existsSync(paths.config())) {
      const cfgPath = paths.config()
      const readCfg = (f: string): Partial<AppState> => JSON.parse(readFileSync(f, 'utf-8')) as Partial<AppState>
      let raw: Partial<AppState>
      try {
        raw = readCfg(cfgPath)
      } catch {
        // 配置损坏或为空：优先用上一次的 .bak，绝不静默清空用户数据
        raw = existsSync(cfgPath + '.bak') ? readCfg(cfgPath + '.bak') : {}
      }
      cache = {
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
        accounts: raw.accounts || [],
        projects: raw.projects || [],
        activeAccountId: raw.activeAccountId,
        activeProjectId: raw.activeProjectId
      }
      // 项目不允许重名：老数据里可能已有同名项目，这里一次性改成「名字 2 / 名字 3」
      {
        const seen = new Set<string>()
        let changed = false
        for (const proj of cache.projects) {
          const base = (proj.name || proj.mcVersion || '未命名项目').trim()
          let cand = base
          let i = 2
          while (seen.has(cand.toLowerCase())) {
            cand = `${base} ${i++}`
          }
          seen.add(cand.toLowerCase())
          if (proj.name !== cand) {
            proj.name = cand
            changed = true
          }
        }
        if (changed) persist()
      }
      return cache
    }
  } catch {
    /* 配置文件损坏则重建 */
  }
  cache = emptyState()
  persist()
  return cache
}

export function persist(): void {
  if (!cache) return
  const tmp = paths.config() + '.tmp'
  writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8')
  renameSync(tmp, paths.config())
}

export function updateSettings(patch: Partial<AppSettings>): AppState {
  const s = state()
  s.settings = { ...s.settings, ...patch }
  persist()
  return s
}

export function setAccounts(accounts: AccountInfo[]): AppState {
  const s = state()
  s.accounts = accounts
  persist()
  return s
}

export function setProjects(projects: GameProject[]): AppState {
  const s = state()
  s.projects = projects
  persist()
  return s
}

export function setActive(patch: { activeAccountId?: string; activeProjectId?: string }): AppState {
  const s = state()
  Object.assign(s, patch)
  persist()
  return s
}

export function defaultSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS }
}
