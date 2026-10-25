import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { ComponentLoader } from '@shared/types'
import { downloadAll } from './http'
import { startTask, updateTask, finishTask } from '../progress'
import { paths } from '../paths'

const API = 'https://api.modrinth.com/v2'
const UA = 'RAINBOWMC-Launcher/0.1.0 (rainbow-mc)'

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  })
  if (!res.ok) throw new Error(`Modrinth ${res.status}`)
  return (await res.json()) as T
}

export type ProjectKind = 'mod' | 'modpack' | 'shader' | 'resourcepack'

export interface MrHit {
  project_id: string
  slug: string
  title: string
  description: string
  icon_url: string | null
  downloads: number
  follows: number
  author?: string
  categories: string[]
  project_type: string
  versions?: string[]
  date_created?: string
  date_modified?: string
}

export interface MrSearchResult {
  hits: MrHit[]
  offset: number
  limit: number
  total_hits: number
}

export interface MrDependency {
  project_id: string | null
  version_id: string | null
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
}

export interface MrVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  dependencies: MrDependency[]
  files: {
    url: string
    filename: string
    size: number
    primary: boolean
    hashes?: { sha1?: string }
  }[]
}

function loaderFacet(loader: ComponentLoader): string[] {
  if (loader === 'vanilla') return []
  return [`categories:${loader}`]
}

/** 搜索资源：按类型 + 加载器 + 游戏版本过滤 */
export async function searchProjects(
  kind: ProjectKind,
  query: string,
  opts: {
    loader?: ComponentLoader | 'any'
    mcVersion?: string
    offset?: number
    limit?: number
    index?: 'relevance' | 'downloads' | 'newest' | 'updated'
  } = {}
): Promise<MrSearchResult> {
  const facets: string[][] = [[`project_type:${kind}`]]
  if (opts.loader && opts.loader !== 'vanilla' && opts.loader !== 'any' && kind === 'mod') {
    facets.push([`categories:${opts.loader}`])
  }
  if (opts.mcVersion && opts.mcVersion !== 'any') facets.push([`versions:${opts.mcVersion}`])
  const params = new URLSearchParams({
    query: query || '',
    limit: String(opts.limit ?? 30),
    offset: String(opts.offset ?? 0),
    index: opts.index ?? (query ? 'relevance' : 'downloads'),
    facets: JSON.stringify(facets)
  })
  return getJson<MrSearchResult>(`${API}/search?${params.toString()}`)
}

/** 某个项目的可用版本（按加载器 / 游戏版本过滤） */
export async function listProjectVersions(
  projectId: string,
  opts: { loader?: ComponentLoader; mcVersion?: string } = {}
): Promise<MrVersion[]> {
  const params: string[] = []
  if (opts.loader && opts.loader !== 'vanilla') params.push(`loaders=${encodeURIComponent(JSON.stringify([opts.loader]))}`)
  if (opts.mcVersion) params.push(`game_versions=${encodeURIComponent(JSON.stringify([opts.mcVersion]))}`)
  return getJson<MrVersion[]>(`${API}/project/${projectId}/version${params.length ? '?' + params.join('&') : ''}`)
}

/** 批量取项目标题（用于依赖/前置提示） */
export async function projectTitles(ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return {}
  const out: Record<string, string> = {}
  const chunk = 50
  for (let i = 0; i < uniq.length; i += chunk) {
    const part = uniq.slice(i, i + chunk)
    const list = await getJson<{ id: string; title: string; slug: string }[]>(
      `${API}/projects?ids=${encodeURIComponent(JSON.stringify(part))}`
    )
    for (const p of list) out[p.id] = p.title
  }
  return out
}

export function kindToFolder(kind: ProjectKind): string {
  if (kind === 'shader') return 'shaderpacks'
  if (kind === 'resourcepack') return 'resourcepacks'
  if (kind === 'modpack') return 'modpacks'
  return 'mods'
}

/** 下载并安装一个版本文件到项目目录，返回落盘文件名 */
export async function installProjectVersion(
  targetProjectDir: string,
  kind: ProjectKind,
  version: MrVersion
): Promise<{ fileName: string; path: string }> {
  const file = version.files.find((f) => f.primary) ?? version.files[0]
  if (!file) throw new Error('该版本没有可下载文件')
  const folder = join(paths.games(), targetProjectDir, kindToFolder(kind))
  mkdirSync(folder, { recursive: true })
  const dest = join(folder, file.filename)
  if (existsSync(dest)) return { fileName: file.filename, path: dest }

  const taskId = 'mod:' + file.filename
  startTask(taskId, `${file.filename}`, 'mod', file.size || 0)
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
    throw new Error('下载失败')
  }
  finishTask(taskId)
  return { fileName: file.filename, path: dest }
}

export interface MrProjectInfo {
  id: string
  slug: string
  title: string
  description: string
  body?: string
  project_type: string
  icon_url?: string | null
  downloads: number
  followers: number
  source_url?: string | null
  wiki_url?: string | null
  issues_url?: string | null
  categories: string[]
  game_versions: string[]
  loaders: string[]
}

/** 项目主页信息 */
export async function getProjectInfo(id: string): Promise<MrProjectInfo> {
  return getJson<MrProjectInfo>(`${API}/project/${id}`)
}

/** 单个版本详情（含依赖） */
export async function getVersion(id: string): Promise<MrVersion> {
  return getJson<MrVersion>(`${API}/version/${id}`)
}