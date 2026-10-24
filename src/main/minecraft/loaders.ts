import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import type { ComponentLoader } from '@shared/types'
import { fetchJson } from './http'
import { downloadAll } from './http'
import { ensureJava, findInstalledJava } from './java'
import { getVersionJson, rulesAllow } from './installer'
import { librariesDir, runtimeDir, versionsDir, versionDir } from './paths'
import { paths } from '../paths'

export interface LoaderOption {
  loader: ComponentLoader
  version: string
  stable?: boolean
}

export interface LoaderSupport {
  fabric: boolean
  quilt: boolean
  forge: boolean
  neoforge: boolean
}

const FORGE_MAVENS = ['https://bmclapi2.bangbang93.com/maven', 'https://maven.minecraftforge.net']
const NEO_MAVENS = [
  'https://maven.neoforged.net/releases',
  'https://bmclapi2.bangbang93.com/maven'
]

/** 依次尝试多个 maven 源，返回第一个成功的结果 */
async function tryBases<T>(bases: string[], path: string, fn: (url: string) => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (const b of bases) {
    try {
      return await fn(`${b}/${path}`)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('all mirrors failed')
}

/* ---------------- 版本支持矩阵 ---------------- */

const gameCache = new Map<string, string[]>()
const neoMetaCache: { at: number; versions: string[] } = { at: 0, versions: [] }

async function metaGame(url: string): Promise<string[]> {
  if (gameCache.has(url)) return gameCache.get(url)!
  const list = await fetchJson<{ version: string; stable: boolean }[]>(url)
  const versions = list.map((v) => v.version)
  gameCache.set(url, versions)
  return versions
}

const forgeMetaCache: { at: number; versions: string[] } = { at: 0, versions: [] }

/** Forge 全量版本（maven-metadata），用来判断某 MC 版本到底有没有 Forge */
async function forgeVersions(): Promise<string[]> {
  if (Date.now() - forgeMetaCache.at < 30 * 60 * 1000 && forgeMetaCache.versions.length) return forgeMetaCache.versions
  const xml = await tryBases(FORGE_MAVENS, 'net/minecraftforge/forge/maven-metadata.xml', (u) => fetchTextMaven(u))
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
  forgeMetaCache.at = Date.now()
  forgeMetaCache.versions = versions
  return versions
}

/** NeoForge 全量版本 */
async function neoVersions(): Promise<string[]> {
  if (Date.now() - neoMetaCache.at < 10 * 60 * 1000 && neoMetaCache.versions.length) return neoMetaCache.versions
  const xml = await tryBases(NEO_MAVENS, 'net/neoforged/neoforge/maven-metadata.xml', (u) => fetchTextMaven(u))
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
  neoMetaCache.at = Date.now()
  neoMetaCache.versions = versions
  return versions
}

function prefixOf(mcVersion: string): string {
  const parts = mcVersion.split('.')
  return parts[0] === '1' ? `${parts[1]}.${parts[2] ?? '0'}` : parts.slice(0, 2).join('.')
}

/** 某个 MC 版本支持哪些加载器（真实数据判断，不猜） */
export async function loaderSupport(mcVersion: string): Promise<LoaderSupport> {
  const [fabric, quilt, forge, neo] = await Promise.all([
    metaGame('https://meta.fabricmc.net/v2/versions/game').catch(() => [] as string[]),
    metaGame('https://meta.quiltmc.org/v3/versions/game').catch(() => [] as string[]),
    forgeVersions().catch(() => [] as string[]),
    neoVersions().catch(() => [] as string[])
  ])
  const pre = prefixOf(mcVersion)
  return {
    fabric: fabric.includes(mcVersion),
    quilt: quilt.includes(mcVersion),
    forge: forge.some((v) => v.startsWith(`${mcVersion}-`)),
    neoforge: neo.some((v) => v.split('.').slice(0, 2).join('.') === pre)
  }
}

/* ---------------- Fabric ---------------- */

interface FabricLoader {
  loader: { version: string; stable: boolean }
}

export async function listFabricLoaders(mcVersion: string): Promise<LoaderOption[]> {
  const list = await fetchJson<FabricLoader[]>(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`)
  return list.slice(0, 30).map((l) => ({ loader: 'fabric' as const, version: l.loader.version, stable: l.loader.stable }))
}

/* ---------------- Quilt ---------------- */

export async function listQuiltLoaders(mcVersion: string): Promise<LoaderOption[]> {
  const list = await fetchJson<FabricLoader[]>(`https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`)
  return list.slice(0, 30).map((l) => ({ loader: 'quilt' as const, version: l.loader.version, stable: l.loader.stable }))
}

interface FabricProfile {
  id: string
  mainClass: string
  libraries: { name: string; url?: string }[]
  arguments?: unknown
}

async function installProfile(
  profile: FabricProfile,
  defaultMaven: string,
  onProgress?: (msg: string) => void
): Promise<{ versionId: string }> {
  const id = profile.id
  const dir = versionDir(id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(profile, null, 2), 'utf-8')

  const tasks = []
  for (const lib of profile.libraries || []) {
    const base = (lib.url || defaultMaven).replace(/\/$/, '')
    const [group, artifact, ver, ...rest] = lib.name.split(':')
    const classifier = rest[0]
    const path = `${group.replace(/\./g, '/')}/${artifact}/${ver}/${artifact}-${ver}${classifier ? '-' + classifier : ''}.jar`
    tasks.push({ url: `${base}/${path}`, dest: join(librariesDir(), path) })
  }
  onProgress?.(`下载 ${tasks.length} 个依赖库`)
  const failed = await downloadAll(tasks, { concurrency: 8 })
  if (failed.length) throw new Error(`${failed.length} 个库下载失败`)
  return { versionId: id }
}

/** Fabric 不需要跑安装器，取 profile json 后把库下下来即可 */
export async function installFabric(
  mcVersion: string,
  loaderVersion: string,
  onProgress?: (msg: string) => void
): Promise<{ versionId: string }> {
  onProgress?.('拉取 Fabric profile')
  const profile = await fetchJson<FabricProfile>(
    `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVersion}/profile/json`
  )
  return installProfile(profile, 'https://maven.fabricmc.net/', onProgress)
}

export async function installQuilt(
  mcVersion: string,
  loaderVersion: string,
  onProgress?: (msg: string) => void
): Promise<{ versionId: string }> {
  onProgress?.('拉取 Quilt profile')
  const profile = await fetchJson<FabricProfile>(
    `https://meta.quiltmc.org/v3/versions/loader/${mcVersion}/${loaderVersion}/profile/json`
  )
  return installProfile(profile, 'https://maven.quiltmc.org/repository/release', onProgress)
}

/* ---------------- Forge / NeoForge ---------------- */

async function forgePromotions(): Promise<Record<string, string>> {
  return fetchJson<Record<string, string>>('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')
}

export async function listForgeVersions(mcVersion: string): Promise<LoaderOption[]> {
  const all = await forgeVersions().catch(() => [] as string[])
  const list: LoaderOption[] = all
    .filter((v) => v.startsWith(`${mcVersion}-`))
    .map((v) => v.slice(mcVersion.length + 1))
    .map((v) => ({ loader: 'forge' as const, version: v, stable: false }))
  if (!list.length) {
    // 元数据拿不到时退回 promotions 的推荐版
    const promos = await forgePromotions().catch(() => ({}) as Record<string, string>)
    const recom = promos[`${mcVersion}-recommended`]
    const latest = promos[`${mcVersion}-latest`]
    if (recom) list.push({ loader: 'forge', version: recom, stable: true })
    if (latest && latest !== recom) list.push({ loader: 'forge', version: latest })
  }
  return list.slice(-40).reverse()
}

async function fetchTextMaven(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(String(res.status))
  return res.text()
}

export async function listNeoForgeVersions(mcVersion: string): Promise<LoaderOption[]> {
  // NeoForge 版本号与 MC 的对应：1.20.4 → 20.4.x，1.21.1 → 21.1.x
  const prefix = prefixOf(mcVersion)
  const all = await neoVersions()
  const matches = all.filter((v) => v.split('.').slice(0, 2).join('.') === prefix)
  return matches.slice(-40).reverse().map((v) => ({ loader: 'neoforge' as const, version: v, stable: true }))
}

function launcherProfiles(): void {
  const p = join(paths.root(), 'launcher_profiles.json')
  if (!existsSync(p)) {
    writeFileSync(
      p,
      JSON.stringify(
        {
          profiles: {},
          settings: { enableSnapshots: false, keepLauncherOpen: false },
          version: 3
        },
        null,
        2
      ),
      'utf-8'
    )
  }
}

async function runInstaller(
  jarPath: string,
  javaMajor: number,
  onProgress?: (msg: string) => void,
  shouldAbort?: () => boolean
): Promise<void> {
  let javaExe = findInstalledJava(javaMajor)
  if (!javaExe) {
    onProgress?.(`下载 Java ${javaMajor}`)
    javaExe = (await ensureJava(javaMajor)).path
  }
  launcherProfiles()
  const TIMEOUT_MS = 12 * 60 * 1000
  await new Promise<void>((resolve, reject) => {
    const JVM_ARGS = [
      '-Dsun.net.client.defaultConnectTimeout=15000',
      '-Dsun.net.client.defaultReadTimeout=15000',
      '-Djava.net.preferIPv4Stack=true'
    ]
    const proc = spawn(javaExe!, [...JVM_ARGS, '-jar', jarPath, '--installClient', paths.root()], {
      cwd: runtimeDir(),
      windowsHide: true
    })
    let out = ''
    let lastLine = ''
    let settled = false
    const done = (err?: Error): void => {
      if (settled) return
      settled = true
      clearInterval(watch)
      clearTimeout(timer)
      if (err) reject(err)
      else resolve()
    }
    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* ignore */
      }
      done(new Error(`安装器超时（12 分钟），已终止。最后输出：${lastLine}`))
    }, TIMEOUT_MS)
    // 停滞检测：安装器联网会无响应地挂住。90 秒既没新文件也没新输出 → 判定卡死
    let lastSig = ''
    let stallSince = Date.now()
    const libDir = librariesDir()
    const dirSig = (dir: string): string => {
      try {
        const fs = require('fs') as typeof import('fs')
        let n = 0
        let bytes = 0
        const walk = (d: string, depth: number): void => {
          if (depth > 3) return
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = `${d}/${e.name}`
            if (e.isDirectory()) walk(p, depth + 1)
            else {
              n++
              try {
                bytes += fs.statSync(p).size
              } catch {
                /* ignore */
              }
            }
          }
        }
        walk(dir, 0)
        return `${n}:${bytes}`
      } catch {
        return ''
      }
    }

    // 每秒检查一次取消标记：点「停止安装」要能立刻杀掉安装器进程
    let lastOutputAt = Date.now()
    const watch = setInterval(() => {
      if (shouldAbort?.()) {
        try {
          proc.kill()
        } catch {
          /* ignore */
        }
        done(new Error('已取消导入'))
        return
      }
      // 停滞检测：libraries 目录 90 秒没有增长，且 90 秒没有新的安装器输出 → 判定卡死
      const sig = dirSig(libDir)
      if (sig !== lastSig) {
        lastSig = sig
        stallSince = Date.now()
      }
      if (lastOutputAt > stallSince) stallSince = lastOutputAt
      if (Date.now() - stallSince > 90_000) {
        try {
          proc.kill()
        } catch {
          /* ignore */
        }
        done(
          new Error(
            `安装器卡死了（90 秒无任何进展），已终止。最后输出：${lastLine || '(无)'}`
          )
        )
      }
    }, 2000)
    proc.stdout?.on('data', (d: Buffer) => {
      const text = d.toString('utf8')
      out += text
      const lines = text.split(/\r?\n/).filter((x) => x.trim())
      if (lines.length) {
        lastLine = lines[lines.length - 1].trim().slice(0, 120)
        lastOutputAt = Date.now()
        onProgress?.(lastLine)
      }
    })
    proc.stderr?.on('data', (d: Buffer) => {
      out += d.toString('utf8')
    })
    proc.on('exit', (code) => {
      if (code === 0) done()
      else done(new Error(`安装器退出码 ${code}：${out.split(/\r?\n/).slice(-4).join(' ')}`))
    })
    proc.on('error', (e) => done(e))
  })
}

/** 记录安装前后新增的版本目录，用来判断安装器生成了哪个版本 id */
function snapshotVersions(): Set<string> {
  try {
    return new Set(readdirSync(versionsDir()))
  } catch {
    return new Set()
  }
}

async function downloadInstaller(urls: string[], dest: string, label: string): Promise<void> {
  for (const url of urls) {
    const failed = await downloadAll([{ url, dest }], { concurrency: 1 })
    if (!failed.length) return
  }
  throw new Error(`${label}安装器下载失败（官方源与镜像都不可用）`)
}

/** 在 versions 目录里找已经装好的加载器版本（名字里同时含 mcVersion 和关键字） */
function findInstalledLoaderVersion(mcVersion: string, keyword: string): string | null {
  try {
    const dirs = readdirSync(versionsDir()).filter(
      (d) => existsSync(join(versionsDir(), d, `${d}.json`))
    )
    const hits = dirs.filter((d) => d.includes(mcVersion) && d.toLowerCase().includes(keyword.toLowerCase()))
    // 取最短的（通常是 <mc>-forge-<ver> 这种标准命名）
    hits.sort((a, b) => a.length - b.length)
    return hits[0] ?? null
  } catch {
    return null
  }
}
/** 用 BMCLAPI 的 maven 镜像把 Forge 安装器要用的库先下好，安装器就会跳过这些下载 */
async function prefetchForgeLibraries(
  jarPath: string,
  onProgress?: (msg: string) => void,
  shouldAbort?: () => boolean
): Promise<void> {
  try {
    const AdmZip = require('adm-zip') as typeof import('adm-zip')
    const zip = new AdmZip(jarPath)
    const entry = zip.getEntry('install_profile.json')
    if (!entry) return
    const prof = JSON.parse(entry.getData().toString('utf8')) as {
      libraries?: { name?: string; downloads?: { artifact?: { path?: string; url?: string } } }[]
    }
    const libs = (prof.libraries ?? []).filter((l) => l.downloads?.artifact?.path)
    if (!libs.length) return
    const tasks = libs.map((l) => {
      const art = l.downloads!.artifact!
      const path = art.path as string
      return {
        url: `https://bmclapi2.bangbang93.com/maven/${path}`,
        altUrls: art.url ? [art.url] : [],
        dest: join(librariesDir(), path)
      }
    })
    let done = 0
    onProgress?.(`预取 Forge 依赖 0/${tasks.length}`)
    for (let i = 0; i < tasks.length; i += 16) {
      if (shouldAbort?.()) return
      // 单批最多 25 秒：预取只是加速手段，某些镜像会挂住不能拖死整个安装
      try {
        await downloadAll(tasks.slice(i, i + 16), {
          concurrency: 16,
          signal: AbortSignal.timeout(25000)
        })
      } catch {
        /* 单批失败就算了，安装器会自己再试 */
      }
      done = Math.min(i + 16, tasks.length)
      onProgress?.(`预取 Forge 依赖 ${done}/${tasks.length}`)
    }
  } catch {
    /* 预取失败不影响主流程，安装器会自己下 */
  }
}
export async function installForge(
  mcVersion: string,
  forgeVersion: string,
  onProgress?: (msg: string) => void,
  shouldAbort?: () => boolean
): Promise<{ versionId: string }> {
  const full = `${mcVersion}-${forgeVersion}`
  const path = `net/minecraftforge/forge/${full}/forge-${full}-installer.jar`
  const jar = join(runtimeDir(), `forge-${full}-installer.jar`)
  mkdirSync(runtimeDir(), { recursive: true })
  onProgress?.('下载 Forge 安装器')
  await downloadInstaller(
    FORGE_MAVENS.map((b) => `${b}/${path}`),
    jar,
    'Forge '
  )

  const base = await getVersionJson(mcVersion, 'official')
  const major = base.javaVersion?.majorVersion ?? 17
  // 先用 BMCLAPI 镜像把安装器要下的库预取到 libraries/，安装器会跳过这些下载（国内快很多）
  await prefetchForgeLibraries(jar, onProgress, shouldAbort)
  const before = snapshotVersions()
  onProgress?.('运行 Forge 安装器（需要一点时间）')
  try {
    await runInstaller(jar, major, onProgress, shouldAbort)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/卡死|超时/.test(msg) && !shouldAbort?.()) {
      // 卡死多半是安装器联网卡住：重新预取依赖后再试一次
      onProgress?.('安装器卡住，正在重试…')
      try {
        await prefetchForgeLibraries(jar, onProgress, shouldAbort)
      } catch {
        /* ignore */
      }
      await runInstaller(jar, major, onProgress, shouldAbort)
    } else {
      throw e
    }
  }
  const after = snapshotVersions()
  const created = [...after].filter((v) => !before.has(v) && v !== '')
  // 已经装过的情况下 created 是空的，必须回查 versions 目录，否则会返回不存在的 id
  const id =
    created.find((c) => existsSync(join(versionsDir(), c, `${c}.json`))) ??
    findInstalledLoaderVersion(mcVersion, forgeVersion) ??
    full
  return { versionId: id }
}

export async function installNeoForge(
  mcVersion: string,
  neoVersion: string,
  onProgress?: (msg: string) => void,
  shouldAbort?: () => boolean
): Promise<{ versionId: string }> {
  const path = `net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`
  const jar = join(runtimeDir(), `neoforge-${neoVersion}-installer.jar`)
  mkdirSync(runtimeDir(), { recursive: true })
  onProgress?.('下载 NeoForge 安装器')
  await downloadInstaller(
    NEO_MAVENS.map((b) => `${b}/${path}`),
    jar,
    'NeoForge '
  )

  const base = await getVersionJson(mcVersion, 'official')
  const major = base.javaVersion?.majorVersion ?? 17
  const before = snapshotVersions()
  onProgress?.('运行 NeoForge 安装器（需要一点时间）')
  await runInstaller(jar, Math.max(17, major), onProgress, shouldAbort)
  const after = snapshotVersions()
  const created = [...after].filter((v) => !before.has(v) && v !== '')
  const id =
    created.find((c) => existsSync(join(versionsDir(), c, `${c}.json`))) ??
    findInstalledLoaderVersion(mcVersion, neoVersion) ??
    `neoforge-${neoVersion}`
  return { versionId: id }
}

export async function listLoaders(loader: ComponentLoader, mcVersion: string): Promise<LoaderOption[]> {
  if (loader === 'fabric') return listFabricLoaders(mcVersion)
  if (loader === 'quilt') return listQuiltLoaders(mcVersion)
  if (loader === 'forge') return listForgeVersions(mcVersion)
  if (loader === 'neoforge') return listNeoForgeVersions(mcVersion)
  return []
}

export function rulesForLoader(): boolean {
  return rulesAllow(undefined)
}

export function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf-8')) as T
}
