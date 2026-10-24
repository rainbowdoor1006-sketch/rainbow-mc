import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { GameProject } from '@shared/types'
import { paths } from '../paths'
import type { ProjectKind } from './modrinth'

export interface InstalledDep {
  projectId: string | null
  type: 'required' | 'optional' | 'incompatible' | 'embedded'
  title?: string
}

export interface ModEntry {
  projectId: string
  title: string
  versionId: string
  versionNumber: string
  fileName: string
  kind: ProjectKind
  gameVersions: string[]
  loaders: string[]
  dependencies: InstalledDep[]
  installedAt: number
}

export interface ModIssue {
  level: 'error' | 'warn'
  code: 'missing-dependency' | 'incompatible' | 'version-mismatch' | 'loader-mismatch'
  message: string
  related?: string[]
}

function manifestPath(projectDir: string): string {
  return join(paths.games(), projectDir, '.rainbowmods.json')
}

export function readManifest(projectDir: string): ModEntry[] {
  const p = manifestPath(projectDir)
  if (!existsSync(p)) return []
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ModEntry[]
  } catch {
    return []
  }
}

export function writeManifest(projectDir: string, list: ModEntry[]): void {
  writeFileSync(manifestPath(projectDir), JSON.stringify(list, null, 2), 'utf-8')
}

export function upsertEntry(projectDir: string, entry: ModEntry): ModEntry[] {
  const list = readManifest(projectDir).filter((e) => e.projectId !== entry.projectId || e.kind !== entry.kind)
  list.push(entry)
  writeManifest(projectDir, list)
  return list
}

export function removeEntry(projectDir: string, fileName: string): ModEntry[] {
  const list = readManifest(projectDir).filter((e) => e.fileName !== fileName)
  writeManifest(projectDir, list)
  return list
}

/**
 * 检查项目里已装组件的问题：
 * - 缺前置（required 依赖没装）
 * - 组件之间声明了 incompatible
 * - 游戏版本 / 加载器对不上
 */
export function checkProject(project: GameProject): ModIssue[] {
  const list = readManifest(project.dir)
  const issues: ModIssue[] = []
  const byId = new Map(list.map((e) => [e.projectId, e]))

  for (const entry of list) {
    for (const dep of entry.dependencies) {
      if (dep.type === 'required' && dep.projectId && !byId.has(dep.projectId)) {
        issues.push({
          level: 'error',
          code: 'missing-dependency',
          message: `该组件可能缺少前置必要运行组件，否则可能导致启动失败（${entry.title} 需要 ${dep.title || dep.projectId}）`,
          related: [entry.title, dep.title || dep.projectId]
        })
      }
      if (dep.type === 'incompatible' && dep.projectId && byId.has(dep.projectId)) {
        issues.push({
          level: 'error',
          code: 'incompatible',
          message: `该组件可能和其他组件或该版本不兼容（${entry.title} ↔ ${byId.get(dep.projectId)?.title}）`,
          related: [entry.title, byId.get(dep.projectId)?.title || '']
        })
      }
    }

    if (entry.kind === 'mod') {
      if (entry.gameVersions.length && !entry.gameVersions.includes(project.mcVersion)) {
        issues.push({
          level: 'warn',
          code: 'version-mismatch',
          message: `该组件可能和其他组件或该版本不兼容（${entry.title}：适配 ${entry.gameVersions.slice(-3).join(' / ')}，当前 ${project.mcVersion}）`,
          related: [entry.title]
        })
      }
      if (project.loader !== 'vanilla' && entry.loaders.length && !entry.loaders.includes(project.loader)) {
        issues.push({
          level: 'warn',
          code: 'loader-mismatch',
          message: `该组件可能和其他组件或该版本不兼容（${entry.title}：只支持 ${entry.loaders.join(' / ')}）`,
          related: [entry.title]
        })
      }
    }
  }

  // 同一个项目装了多个版本的文件
  const dup = new Map<string, number>()
  for (const e of list) dup.set(e.projectId, (dup.get(e.projectId) ?? 0) + 1)
  for (const [id, count] of dup) {
    if (count > 1) {
      const title = byId.get(id)?.title ?? id
      issues.push({
        level: 'warn',
        code: 'incompatible',
        message: `该组件可能和其他组件或该版本不兼容（${title} 装了 ${count} 个版本，可能冲突）`,
        related: [title]
      })
    }
  }

  return issues
}
