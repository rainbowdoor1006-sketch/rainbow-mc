import { existsSync, mkdirSync, readFileSync, copyFileSync, unlinkSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { paths } from '../paths'
import { downloadAll } from './http'
import { startTask, updateTask, finishTask } from '../progress'
import type { ProjectKind } from './modrinth'
import { readManifest, upsertEntry } from './mods'
import type { GameProject } from '@shared/types'

export interface LoaderMeta {
  type: string
  version: string
  mcVersion: string
}

export interface LibEntry {
  id: string
  /** Modrinth 项目 id */
  projectId: string
  title: string
  kind: ProjectKind | 'loader'
  versionId: string
  versionNumber: string
  fileName: string
  /** 相对库目录的路径 */
  relPath: string
  loaders: string[]
  gameVersions: string[]
  size: number
  downloadedAt: number
  iconUrl?: string
  /** 加载器条目才有 */
  loader?: LoaderMeta
}

const FOLDER: Record<string, string> = {
  mod: 'mods',
  modpack: 'modpacks',
  shader: 'shaderpacks',
  resourcepack: 'resourcepacks',
  loader: 'loaders'
}

export function libraryRoot(): string {
  return join(paths.root(), 'library')
}

export function libraryDir(kind: ProjectKind): string {
  return join(libraryRoot(), FOLDER[kind] || 'mods')
}

function manifestFile(): string {
  return join(libraryRoot(), 'library.json')
}

export function listLibrary(): LibEntry[] {
  if (!existsSync(manifestFile())) return []
  try {
    return JSON.parse(readFileSync(manifestFile(), 'utf-8')) as LibEntry[]
  } catch {
    return []
  }
}

function saveLibrary(list: LibEntry[]): void {
  mkdirSync(libraryRoot(), { recursive: true })
  writeFileSync(manifestFile(), JSON.stringify(list, null, 2), 'utf-8')
}

/** 下载一个组件到组件库（不装进任何项目） */
export async function downloadToLibrary(
  title: string,
  kind: ProjectKind,
  projectId: string,
  version: {
    id: string
    version_number: string
    loaders: string[]
    game_versions: string[]
    files: { url: string; filename: string; size: number; primary: boolean }[]
  },
  iconUrl?: string,
  slug?: string
): Promise<{ ok: boolean; entry?: LibEntry; message?: string }> {
  const file = version.files.find((f) => f.primary) ?? version.files[0]
  if (!file) return { ok: false, message: '该版本没有可下载文件' }

  const dir = libraryDir(kind)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, file.filename)

  const existing = listLibrary().find((e) => e.kind === kind && e.fileName === file.filename)
  if (existing && existsSync(dest)) return { ok: true, entry: existing }

  const taskId = 'lib:' + file.filename
  startTask(taskId, file.filename, kind === 'mod' ? 'mod' : 'other', file.size || 0)
  const failed = await downloadAll(
    [
      {
        url: file.url,
        dest,
        onBytes: (loaded, total) => updateTask(taskId, { loaded, total: total || file.size || 0 })
      }
    ],
    { concurrency: 1 }
  )
  if (failed.length) {
    finishTask(taskId)
    return { ok: false, message: '下载失败' }
  }
  finishTask(taskId)

  const entry: LibEntry = {
    id: `${kind}:${file.filename}`,
    projectId,
    title,
    kind,
    versionId: version.id,
    versionNumber: version.version_number,
    fileName: file.filename,
    relPath: join(FOLDER[kind] || 'mods', file.filename),
    loaders: version.loaders,
    gameVersions: version.game_versions,
    size: existsSync(dest) ? statSync(dest).size : file.size,
    downloadedAt: Date.now(),
    iconUrl
  }
  const list = listLibrary().filter((e) => e.id !== entry.id)
  list.push(entry)
  saveLibrary(list)
  return { ok: true, entry }
}

/** 删除库里的组件 */
export function removeFromLibrary(id: string): { ok: boolean; usedBy: string[] } {
  const list = listLibrary()
  const entry = list.find((e) => e.id === id)
  if (!entry) return { ok: false, usedBy: [] }
  const usedBy = usageProjects(entry)
  const abs = join(libraryRoot(), entry.relPath)
  if (existsSync(abs)) {
    try {
      unlinkSync(abs)
    } catch {
      /* ignore */
    }
  }
  saveLibrary(list.filter((e) => e.id !== id))
  return { ok: true, usedBy }
}

/** 这个库组件被哪些项目用了 */
export function usageProjects(entry: LibEntry): string[] {
  const out: string[] = []
  for (const p of projectList()) {
    const modsDir = join(paths.games(), p.dir, FOLDER[entry.kind] || 'mods')
    if (existsSync(join(modsDir, entry.fileName))) out.push(p.name)
  }
  return out
}

let projectGetter: (() => GameProject[]) | null = null
export function initLibrary(getProjects: () => GameProject[]): void {
  projectGetter = getProjects
}
function projectList(): GameProject[] {
  return projectGetter ? projectGetter() : []
}

/** 把库组件复制到某个项目 */
export function applyToProject(ids: string[], projectId: string): { ok: boolean; copied: string[]; message?: string } {
  const project = projectList().find((p) => p.id === projectId)
  if (!project) return { ok: false, copied: [], message: '项目不存在' }
  const lib = listLibrary()
  const copied: string[] = []
  for (const id of ids) {
    const entry = lib.find((e) => e.id === id)
    if (!entry) continue
    const src = join(libraryRoot(), entry.relPath)
    if (!existsSync(src)) continue
    const dir = join(paths.games(), project.dir, FOLDER[entry.kind] || 'mods')
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, entry.fileName)
    try {
      copyFileSync(src, dest)
      copied.push(entry.title)
      if (entry.kind === 'mod') {
        upsertEntry(project.dir, {
          projectId: entry.projectId,
          title: entry.title,
          versionId: entry.versionId,
          versionNumber: entry.versionNumber,
          fileName: entry.fileName,
          kind: 'mod',
          gameVersions: entry.gameVersions,
          loaders: entry.loaders,
          dependencies: [],
          installedAt: Date.now()
        })
      }
    } catch {
      /* ignore single failure */
    }
  }
  return { ok: copied.length > 0, copied }
}

/** 项目里已有哪些库组件 */
export function projectLibraryState(projectId: string): Record<string, boolean> {
  const project = projectList().find((p) => p.id === projectId)
  const out: Record<string, boolean> = {}
  if (!project) return out
  for (const e of listLibrary()) {
    const abs = join(paths.games(), project.dir, FOLDER[e.kind] || 'mods', e.fileName)
    out[e.id] = existsSync(abs)
  }
  return out
}

/** 项目当前的 mods 清单（给“添加组件”弹窗判断用） */
export function projectManifest(projectId: string): { projectId: string; fileName: string }[] {
  const project = projectList().find((p) => p.id === projectId)
  if (!project) return []
  return readManifest(project.dir).map((m) => ({ projectId: m.projectId, fileName: m.fileName }))
}

/** 记录一个已安装/已下载的加载器 */
export function addLoaderEntry(meta: LoaderMeta): LibEntry {
  const list = listLibrary()
  const id = `loader:${meta.type}-${meta.version}-${meta.mcVersion}`
  const entry: LibEntry = {
    id,
    projectId: '',
    title: `${meta.type === 'neoforge' ? 'NeoForge' : meta.type[0].toUpperCase() + meta.type.slice(1)} ${meta.version}`,
    kind: 'loader',
    versionId: id,
    versionNumber: meta.version,
    fileName: '',
    relPath: '',
    loaders: [meta.type],
    gameVersions: [meta.mcVersion],
    size: 0,
    downloadedAt: Date.now(),
    loader: meta
  }
  const next = list.filter((e) => e.id !== id)
  next.push(entry)
  saveLibrary(next)
  return entry
}
