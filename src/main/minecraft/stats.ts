import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { paths } from '../paths'
import type { GameProject } from '@shared/types'

/** 项目体积与构成统计（带 60 秒缓存，避免每次打开面板都扫盘） */
export interface ProjectSummary {
  mods: number
  shaders: number
  resourcePacks: number
  saves: number
  latestLogAt: number | null
  totalMb: number
  breakdown: { key: string; label: string; mb: number }[]
}

const cache = new Map<string, { at: number; data: ProjectSummary }>()
const TTL = 60_000

function dirMb(dir: string): number {
  let sum = 0
  try {
    const walk = (d: string, depth: number): void => {
      if (depth > 4) return
      let entries: import('fs').Dirent[]
      try {
        entries = readdirSync(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p, depth + 1)
        else {
          try {
            sum += statSync(p).size
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (existsSync(dir)) walk(dir, 0)
  } catch {
    /* ignore */
  }
  return sum
}

function countFiles(dir: string, ext: string): number {
  try {
    return readdirSync(dir).filter((f) => f.toLowerCase().endsWith(ext)).length
  } catch {
    return 0
  }
}

function countDirs(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).length
  } catch {
    return 0
  }
}

export function projectSummary(project: GameProject): ProjectSummary {
  const hit = cache.get(project.id)
  if (hit && Date.now() - hit.at < TTL) return hit.data

  const inst = join(paths.games(), project.dir)
  const parts: { key: string; label: string; dir: string }[] = [
    { key: 'mods', label: '模组', dir: join(inst, 'mods') },
    { key: 'config', label: '配置', dir: join(inst, 'config') },
    { key: 'saves', label: '存档', dir: join(inst, 'saves') },
    { key: 'resourcepacks', label: '资源包', dir: join(inst, 'resourcepacks') },
    { key: 'shaderpacks', label: '光影', dir: join(inst, 'shaderpacks') },
    { key: 'logs', label: '日志', dir: join(inst, 'logs') }
  ]
  const breakdown = parts
    .map((p) => ({ key: p.key, label: p.label, mb: Math.round((dirMb(p.dir) / 1048576) * 10) / 10 }))
    .filter((p) => p.mb > 0)

  let latestLogAt: number | null = null
  try {
    const log = join(inst, 'logs', 'latest.log')
    if (existsSync(log)) latestLogAt = statSync(log).mtimeMs
  } catch {
    /* ignore */
  }

  const data: ProjectSummary = {
    mods: countFiles(join(inst, 'mods'), '.jar'),
    shaders: countFiles(join(inst, 'shaderpacks'), '.zip'),
    resourcePacks: countFiles(join(inst, 'resourcepacks'), '.zip'),
    saves: countDirs(join(inst, 'saves')),
    latestLogAt,
    totalMb: Math.round(breakdown.reduce((s, p) => s + p.mb, 0) * 10) / 10,
    breakdown
  }
  cache.set(project.id, { at: Date.now(), data })
  return data
}

/** 启动耗时格式化：42.3s / 2分18秒 */
export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '—'
  const s = ms / 1000
  if (s < 60) return s.toFixed(1) + ' 秒'
  const m = Math.floor(s / 60)
  return `${m} 分 ${Math.round(s - m * 60)} 秒`
}
