import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from '@shared/types'
import type { InstallProgress, LibraryEntry, MinecraftVersionJson, VersionSummary } from '@shared/mclib'
import { fetchJson } from './http'
import { downloadAll, ensureDir, type DownloadTask } from './http'
import { assetsDir, cacheDir, librariesDir, manifestUrl, resourceUrl, rewriteUrl, versionDir } from './paths'

interface Manifest {
  latest: { release: string; snapshot: string }
  versions: VersionSummary[]
}

let manifestCache: { at: number; data: Manifest; source: string } | null = null

export async function getManifest(source: AppSettings['downloadSource'], force = false): Promise<Manifest> {
  const url = manifestUrl(source)
  if (!force && manifestCache && manifestCache.source === source && Date.now() - manifestCache.at < 10 * 60 * 1000) {
    return manifestCache.data
  }
  try {
    const data = await fetchJson<Manifest>(url)
    manifestCache = { at: Date.now(), data, source }
    ensureDir(cacheDir())
    writeFileSync(join(cacheDir(), 'version_manifest.json'), JSON.stringify(data))
    return data
  } catch (e) {
    const cached = join(cacheDir(), 'version_manifest.json')
    if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf-8')) as Manifest
    throw e
  }
}

export async function getVersionJson(
  id: string,
  source: AppSettings['downloadSource']
): Promise<MinecraftVersionJson> {
  const local = join(versionDir(id), `${id}.json`)
  if (existsSync(local)) {
    try {
      return JSON.parse(readFileSync(local, 'utf-8')) as MinecraftVersionJson
    } catch {
      /* 本地损坏则重新下载 */
    }
  }
  const manifest = await getManifest(source)
  const entry = manifest.versions.find((v) => v.id === id)
  if (!entry) throw new Error(`version ${id} not found in manifest`)
  const json = await fetchJson<MinecraftVersionJson>(rewriteUrl(entry.url, source))
  ensureDir(versionDir(id))
  writeFileSync(local, JSON.stringify(json, null, 2))
  return json
}

/** 规则求值：Windows / x64，特性全部按 false 处理 */
export function rulesAllow(rules?: LibraryEntry['rules']): boolean {
  if (!rules || rules.length === 0) return true
  let allowed = false
  for (const rule of rules) {
    const osOk = !rule.os || rule.os.name === undefined || rule.os.name === 'windows'
    const archOk = !rule.os?.arch || rule.os.arch === 'x86_64' || rule.os.arch === '64'
    const featOk = !rule.features || Object.values(rule.features).every((v) => v === false)
    if (osOk && archOk && featOk) allowed = rule.action === 'allow'
  }
  return allowed
}

function libraryTasks(json: MinecraftVersionJson, source: AppSettings['downloadSource']): DownloadTask[] {
  const tasks: DownloadTask[] = []
  for (const lib of json.libraries || []) {
    if (!rulesAllow(lib.rules)) continue
    const art = lib.downloads?.artifact
    if (art?.url) {
      tasks.push({
        url: rewriteUrl(art.url, source),
        dest: join(librariesDir(), art.path),
        sha1: art.sha1,
        size: art.size
      })
    }
    const natives = lib.natives?.windows
    if (natives && lib.downloads?.classifiers) {
      const key = natives.replace('${arch}', '64')
      const cls = lib.downloads.classifiers[key]
      if (cls?.url) {
        tasks.push({
          url: rewriteUrl(cls.url, source),
          dest: join(librariesDir(), cls.path),
          sha1: cls.sha1,
          size: cls.size
        })
      }
    }
  }
  return tasks
}

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>
  virtual?: boolean
  map_to_resources?: boolean
}

function readAssetObjects(indexId: string): AssetIndex | null {
  const p = join(assetsDir(), 'indexes', `${indexId}.json`)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as AssetIndex
  } catch {
    return null
  }
}

/**
 * 安装一个原版版本：客户端 jar + 依赖库 + 资源文件。
 * onProgress 会分阶段回调，便于界面显示进度。
 */
export async function installVersion(
  id: string,
  source: AppSettings['downloadSource'],
  onProgress: (p: InstallProgress) => void
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = []
  const report = (stage: InstallProgress['stage'], done: number, total: number, bytes: number, message?: string): void =>
    onProgress({ versionId: id, stage, done, total, bytes, message })

  report('prepare', 0, 1, 0)
  const json = await getVersionJson(id, source)
  ensureDir(versionDir(id))

  // 1. 客户端 jar
  report('client', 0, 1, 0)
  const client = json.downloads?.client
  if (client?.url) {
    const failed = await downloadAll(
      [{ url: rewriteUrl(client.url, source), dest: join(versionDir(id), `${id}.jar`), sha1: client.sha1, size: client.size }],
      { concurrency: 1, onProgress: (d, t, b) => report('client', d, t, b) }
    )
    for (const f of failed) errors.push(`client: ${f.url}`)
  }
  report('client', 1, 1, 0)

  // 2. 依赖库
  const libs = libraryTasks(json, source)
  report('libraries', 0, libs.length, 0)
  const libFailed = await downloadAll(libs, {
    concurrency: 8,
    onProgress: (d, t, b) => report('libraries', d, t, b)
  })
  for (const f of libFailed) errors.push(`library: ${f.url}`)

  // 3. 资源索引与对象
  if (json.assetIndex) {
    const indexDest = join(assetsDir(), 'indexes', `${json.assetIndex.id}.json`)
    if (!existsSync(indexDest)) {
      ensureDir(join(assetsDir(), 'indexes'))
      const failed = await downloadAll(
        [
          {
            url: rewriteUrl(json.assetIndex.url, source),
            dest: indexDest,
            sha1: json.assetIndex.sha1,
            size: json.assetIndex.size
          }
        ],
        { concurrency: 1 }
      )
      for (const f of failed) errors.push(`assetIndex: ${f.url}`)
    }
    const index = readAssetObjects(json.assetIndex.id)
    if (index) {
      const objs = Object.values(index.objects)
      const tasks: DownloadTask[] = objs.map((o) => ({
        url: resourceUrl(o.hash, source),
        dest: join(assetsDir(), 'objects', o.hash.slice(0, 2), o.hash),
        sha1: o.hash,
        size: o.size
      }))
      report('assets', 0, tasks.length, 0)
      const failed = await downloadAll(tasks, {
        concurrency: 12,
        onProgress: (d, t, b) => report('assets', d, t, b)
      })
      for (const f of failed) errors.push(`asset: ${f.url}`)
    }
  }

  // 3.5 老版本（1.6 及以前）资源要摊平到 assets/virtual/<indexId>/
  if (json.assetIndex) {
    const index = readAssetObjects(json.assetIndex.id)
    if (index && (index.virtual || json.assets === 'legacy' || json.assets === 'pre-1.6')) {
      const virtualRoot = join(assetsDir(), 'virtual', json.assetIndex.id)
      ensureDir(virtualRoot)
      let copied = 0
      for (const [name, obj] of Object.entries(index.objects)) {
        const src = join(assetsDir(), 'objects', obj.hash.slice(0, 2), obj.hash)
        const dst = join(virtualRoot, name)
        if (!existsSync(src)) continue
        if (existsSync(dst) && statSync(dst).size === obj.size) continue
        ensureDir(join(dst, '..'))
        try {
          require('fs').copyFileSync(src, dst)
          copied++
        } catch {
          /* 单个资源复制失败不阻塞 */
        }
      }
      if (copied) report('assets', 1, 1, 0, `已展开 ${copied} 个老版本资源`)
    }
  }

  // 4. log4j 配置（没有它游戏只输出 ERROR，且不写 latest.log）
  const logCfg = json.logging?.client?.file
  if (logCfg?.url) {
    const dest = join(assetsDir(), 'log_configs', logCfg.id)
    if (!existsSync(dest)) {
      ensureDir(join(assetsDir(), 'log_configs'))
      const failed = await downloadAll(
        [{ url: rewriteUrl(logCfg.url, source), dest, sha1: logCfg.sha1, size: logCfg.size }],
        { concurrency: 1 }
      )
      for (const f of failed) errors.push(`logConfig: ${f.url}`)
    }
  }

  // 5. 记录安装信息
  const meta = {
    id,
    type: json.type,
    installedAt: Date.now(),
    javaMajor: json.javaVersion?.majorVersion ?? 8,
    size: dirSize(versionDir(id))
  }
  writeFileSync(join(versionDir(id), '.rainbow.json'), JSON.stringify(meta, null, 2))

  report('done', 1, 1, 0, errors.length ? `${errors.length} 个文件失败` : undefined)
  return { ok: errors.length === 0, errors }
}

function dirSize(dir: string): number {
  try {
    return statSync(dir).size
  } catch {
    return 0
  }
}

export function listInstalledVersions(): { id: string; type: string; installedAt: number }[] {
  const root = join(librariesDir(), '..', 'versions')
  const out: { id: string; type: string; installedAt: number }[] = []
  try {
    const fs = require('fs') as typeof import('fs')
    for (const name of fs.readdirSync(root)) {
      const metaPath = join(root, name, '.rainbow.json')
      if (!existsSync(metaPath)) continue
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        out.push({ id: meta.id ?? name, type: meta.type ?? 'release', installedAt: meta.installedAt ?? 0 })
      } catch {
        /* 忽略损坏条目 */
      }
    }
  } catch {
    /* 目录不存在 */
  }
  return out.sort((a, b) => b.installedAt - a.installedAt)
}

export function ensureVersionDirs(): void {
  ensureDir(join(librariesDir()))
  mkdirSync(assetsDir(), { recursive: true })
}

/** group:artifact:version[:classifier] → maven 相对路径 */
function mavenPath(name: string): string | null {
  const parts = (name || '').split(':')
  if (parts.length < 3) return null
  const [group, artifact, version, classifier] = parts
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.jar`
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`
}

/**
 * 启动/导入前的「缺库补齐」：
 * 按版本继承链把 json 里要求的所有库、客户端 jar、log4j 配置检查一遍，缺什么下什么。
 *
 * 为什么需要：库是整个 data\libraries 共享的，不同版本会引用不同版本号的同一个库
 * （例如 1.20.1 需要 log4j 2.19.0，26.3 需要 2.26.0）。
 * 只装过 26.3 的机器上，1.20.1 启动就会因为缺 2.19.0 直接崩：
 *   java.lang.module.FindException: Module org.apache.logging.log4j not found
 */
export async function ensureVersionFiles(
  versionId: string,
  source: AppSettings['downloadSource'],
  onStep?: (msg: string) => void
): Promise<{ downloaded: number; failed: number }> {
  const { getVersionJsonChain } = await import('./versionchain')
  const { json, versionId: baseId } = await getVersionJsonChain(versionId, source)
  const tasks: DownloadTask[] = []

  // 1) 库
  for (const lib of json.libraries ?? []) {
    if (!rulesAllow(lib.rules)) continue
    const art = lib.downloads?.artifact
    if (art?.path) {
      tasks.push({
        url: rewriteUrl(art.url || '', source),
        dest: join(librariesDir(), art.path),
        sha1: art.sha1,
        size: art.size
      })
      continue
    }
    // 只给 maven 坐标的库（Forge/NeoForge 常见）
    const rel = mavenPath(lib.name)
    if (!rel) continue
    const base = (lib as { url?: string }).url || 'https://libraries.minecraft.net/'
    tasks.push({ url: rewriteUrl(base.replace(/\/?$/, '/') + rel, source), dest: join(librariesDir(), rel) })
  }

  // 2) 客户端 jar
  const client = (json.downloads as { client?: { url: string; sha1: string; size: number } } | undefined)?.client
  if (client?.url) {
    tasks.push({
      url: rewriteUrl(client.url, source),
      dest: join(versionDir(baseId), `${baseId}.jar`),
      sha1: client.sha1,
      size: client.size
    })
  }

  // 3) log4j 配置（没有它游戏不写 latest.log）
  const logCfg = json.logging?.client?.file
  if (logCfg?.url) {
    tasks.push({
      url: rewriteUrl(logCfg.url, source),
      dest: join(assetsDir(), 'log_configs', logCfg.id),
      sha1: logCfg.sha1,
      size: logCfg.size
    })
  }

  // 只下缺失的
  const missing = tasks.filter((t) => {
    try {
      if (!existsSync(t.dest)) return true
      if (t.size && statSync(t.dest).size !== t.size) return true
      return false
    } catch {
      return true
    }
  })
  if (!missing.length) return { downloaded: 0, failed: 0 }

  onStep?.(`补齐游戏库 ${missing.length} 个文件`)
  let done = 0
  const failed: DownloadTask[] = []
  for (let i = 0; i < missing.length; i += 16) {
    const slice = missing.slice(i, i + 16)
    const f = await downloadAll(slice, { concurrency: 8 })
    failed.push(...f)
    done += slice.length
    onStep?.(`补齐游戏库 ${Math.min(done, missing.length)}/${missing.length}`)
  }
  return { downloaded: missing.length - failed.length, failed: failed.length }
}
/**
 * 补齐游戏资源（assets）：语言文件、声音、字体、贴图索引都在这里。
 * 缺了不会崩，但会出现「语言列表空白」「没有声音」这类问题。
 */
export async function ensureAssets(
  versionId: string,
  source: AppSettings['downloadSource'],
  onStep?: (msg: string) => void
): Promise<{ downloaded: number; failed: number; total: number }> {
  const { getVersionJsonChain } = await import('./versionchain')
  const { json } = await getVersionJsonChain(versionId, source)
  const idx = (json as { assetIndex?: { id: string; url: string; sha1?: string; size?: number } }).assetIndex
  if (!idx?.url) return { downloaded: 0, failed: 0, total: 0 }

  // 1) 资源索引
  const indexPath = join(assetsDir(), 'indexes', `${idx.id}.json`)
  ensureDir(join(assetsDir(), 'indexes'))
  if (!existsSync(indexPath) || (idx.size && statSync(indexPath).size !== idx.size)) {
    onStep?.(`下载资源索引 ${idx.id}…`)
    await downloadAll(
      [{ url: rewriteUrl(idx.url, source), dest: indexPath, sha1: idx.sha1, size: idx.size }],
      { concurrency: 1 }
    )
  }

  const data = readAssetObjects(idx.id)
  if (!data?.objects) return { downloaded: 0, failed: 0, total: 0 }

  // 2) 每个资源对象
  const tasks: DownloadTask[] = []
  for (const key of Object.keys(data.objects)) {
    const o = data.objects[key]
    const h = o.hash
    if (!h) continue
    tasks.push({
      url: rewriteUrl(`https://resources.download.minecraft.net/${h.slice(0, 2)}/${h}`, source),
      dest: join(assetsDir(), 'objects', h.slice(0, 2), h),
      size: o.size
    })
  }

  const missing = tasks.filter((t) => {
    try {
      if (!existsSync(t.dest)) return true
      if (t.size && statSync(t.dest).size !== t.size) return true
      return false
    } catch {
      return true
    }
  })
  if (!missing.length) return { downloaded: 0, failed: 0, total: tasks.length }

  onStep?.(`补齐游戏资源 ${missing.length} 个文件（首次下载较多，请耐心等待）`)
  let done = 0
  let failedCount = 0
  for (let i = 0; i < missing.length; i += 64) {
    const slice = missing.slice(i, i + 64)
    const f = await downloadAll(slice, { concurrency: 16 })
    failedCount += f.length
    done += slice.length
    onStep?.(`补齐游戏资源 ${Math.min(done, missing.length)}/${missing.length}`)
  }
  return { downloaded: missing.length - failedCount, failed: failedCount, total: tasks.length }
}
