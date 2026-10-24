import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { GameProject } from '@shared/types'
import { paths } from '../paths'

export interface ModFile {
  fileName: string
  enabled: boolean
  size: number
  mtime: number
}

export interface SaveInfo {
  name: string
  size: number
  mtime: number
}

function gameDir(project: GameProject): string {
  return join(paths.games(), project.dir)
}

/** 列出实例 mods 目录（含被禁用的 .jar.disabled） */
export function listModFiles(project: GameProject): ModFile[] {
  const dir = join(gameDir(project), 'mods')
  if (!existsSync(dir)) return []
  const out: ModFile[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jar') && !name.endsWith('.jar.disabled')) continue
    const p = join(dir, name)
    try {
      const st = statSync(p)
      const disabled = name.endsWith('.disabled')
      out.push({
        fileName: disabled ? name.replace(/\.disabled$/, '') : name,
        enabled: !disabled,
        size: st.size,
        mtime: st.mtimeMs
      })
    } catch {
      /* 忽略读不到的文件 */
    }
  }
  return out.sort((a, b) => a.fileName.localeCompare(b.fileName))
}

/** 启用/禁用模组：改名 .jar ↔ .jar.disabled（PCL 同款做法） */
export function toggleMod(project: GameProject, fileName: string): ModFile[] {
  const dir = join(gameDir(project), 'mods')
  const enabledPath = join(dir, fileName)
  const disabledPath = join(dir, fileName + '.disabled')
  if (existsSync(enabledPath)) renameSync(enabledPath, disabledPath)
  else if (existsSync(disabledPath)) renameSync(disabledPath, enabledPath)
  return listModFiles(project)
}

export function deleteMod(project: GameProject, fileName: string): ModFile[] {
  const dir = join(gameDir(project), 'mods')
  for (const p of [join(dir, fileName), join(dir, fileName + '.disabled')]) {
    if (existsSync(p)) {
      try {
        rmSync(p, { force: true })
      } catch {
        /* 文件被占用时忽略 */
      }
    }
  }
  return listModFiles(project)
}

/** 列存档：saves 下每个含 level.dat 的目录 */
export function listSaves(project: GameProject): SaveInfo[] {
  const dir = join(gameDir(project), 'saves')
  if (!existsSync(dir)) return []
  const out: SaveInfo[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    try {
      const st = statSync(p)
      if (!st.isDirectory()) continue
      if (!existsSync(join(p, 'level.dat'))) continue
      out.push({ name, size: dirSize(p), mtime: st.mtimeMs })
    } catch {
      /* ignore */
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

function dirSize(dir: string): number {
  let total = 0
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      try {
        const st = statSync(p)
        if (st.isDirectory()) walk(p)
        else total += st.size
      } catch {
        /* ignore */
      }
    }
  }
  try {
    walk(dir)
  } catch {
    /* ignore */
  }
  return total
}

/** 备份存档为 zip，放到实例的 backups 目录 */
export function backupSave(project: GameProject, saveName: string): { ok: boolean; path?: string; message?: string } {
  const src = join(gameDir(project), 'saves', saveName)
  if (!existsSync(src)) return { ok: false, message: '存档不存在' }
  const outDir = join(gameDir(project), 'backups')
  mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const out = join(outDir, `${saveName}-${stamp}.zip`)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AdmZip = require('adm-zip') as typeof import('adm-zip')
    const zip = new AdmZip()
    zip.addLocalFolder(src, saveName)
    zip.writeZip(out)
    return { ok: true, path: out }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export function deleteSave(project: GameProject, saveName: string): SaveInfo[] {
  const p = join(gameDir(project), 'saves', saveName)
  try {
    rmSync(p, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  return listSaves(project)
}

export function instanceDir(project: GameProject): string {
  return gameDir(project)
}

export function screenshotDir(project: GameProject): string {
  return join(gameDir(project), 'screenshots')
}

/** 导出启动脚本（.bat），方便脱离启动器直接跑 */
export function exportStartScript(project: GameProject, javaExe: string, args: string[]): string {
  const jarDir = gameDir(project)
  mkdirSync(jarDir, { recursive: true })
  const out = join(jarDir, 'start-rainbow.bat')
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    `cd /d "${jarDir}"`,
    `"${javaExe}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
    'pause'
  ]
  require('fs').writeFileSync(out, lines.join('\r\n'), 'utf-8')
  return out
}

export interface ImportResult {
  /** CurseForge 包里需要按 ID 下载的模组数量 */
  missingMods?: number
  /** 从包里直接解压出来的模组数量 */
  extractedMods?: number
  /** CurseForge 包需要按 ID 下载的文件清单（projectID/fileID） */
  cfFiles?: { projectId: number; fileId: number }[]
  ok: boolean
  projectId?: string
  name?: string
  mcVersion?: string
  loader?: string
  message?: string
}

/** 导入整合包：支持 Rainbow 导出的 zip 与 Modrinth .mrpack */
type ZipLike = { getEntries(): { entryName: string; isDirectory: boolean; getData(): Buffer; header: { size: number } }[] }

/** 从整合包 zip 里把 mods/config/… 解压到实例目录，边解压边报进度（按字节） */
function extractPackContent(
  zip: ZipLike,
  root: string,
  onFile: (done: number, total: number, name: string) => void,
  shouldAbort?: () => boolean
): { extracted: number; mods: number } {
  const KEEP = ['mods/', 'config/', 'defaultconfigs/', 'resourcepacks/', 'shaderpacks/', 'saves/', 'kubejs/', 'scripts/']
  const KEEP_FILE = ['options.txt', 'servers.dat', 'optionsof.txt', 'shaderpacks.txt']
  const plan: { rel: string; entry: { getData(): Buffer; header: { size: number } } }[] = []
  let total = 0
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue
    let name = e.entryName.replace(/\\/g, '/')
    if (name.startsWith('overrides/')) name = name.slice('overrides/'.length)
    else if (name.startsWith('.minecraft/')) name = name.slice('.minecraft/'.length)
    if (KEEP.some((k) => name.startsWith(k)) || KEEP_FILE.includes(name)) {
      plan.push({ rel: name, entry: e })
      total += (e.header?.size as number) || 0
    }
  }
  let done = 0
  let mods = 0
  for (const item of plan) {
    if (shouldAbort?.()) break
    const target = join(root, item.rel)
    mkdirSync(join(target, '..'), { recursive: true })
    try {
      writeFileSync(target, item.entry.getData())
      if (item.rel.startsWith('mods/')) mods++
    } catch {
      /* 单个文件失败不阻塞 */
    }
    done += (item.entry.header?.size as number) || 0
    onFile(done, total, item.rel)
  }
  return { extracted: plan.length, mods }
}
export async function importPack(
  packPath: string,
  makeProject: (p: {
    name: string
    mcVersion: string
    loader: string
    loaderVersion?: string
  }) => GameProject,
  onProgress?: (p: { stage: 'analyze' | 'extract' | 'download'; done: number; total: number }) => void,
  shouldAbort?: () => boolean,
  signal?: AbortSignal
): Promise<ImportResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AdmZip = require('adm-zip') as typeof import('adm-zip')
  let zip: import('adm-zip')
  try {
    zip = new AdmZip(packPath)
  } catch (e) {
    return { ok: false, message: '不是可识别的整合包压缩文件' }
  }

  const onProgressExtract = (done: number, total: number, name?: string): void =>
    onProgress?.({ stage: 'extract', done, total } as never)
  onProgress?.({ stage: 'analyze', done: 0, total: 1 })
  if (shouldAbort?.()) return { ok: false, message: '已取消导入' }
  const entries = zip.getEntries().map((e) => e.entryName)
  const isMrpack = entries.includes('modrinth.index.json') || packPath.toLowerCase().endsWith('.mrpack')

  if (isMrpack) {
    const indexEntry = zip.getEntry('modrinth.index.json')
    if (!indexEntry) return { ok: false, message: '缺少 modrinth.index.json' }
    const index = JSON.parse(indexEntry.getData().toString('utf8')) as {
      name?: string
      dependencies?: Record<string, string>
      files?: { path: string; downloads?: string[]; fileSize?: number }[]
    }
    const deps = index.dependencies ?? {}
    const mcVersion = deps['minecraft'] ?? ''
    let loader = 'vanilla'
    let loaderVersion: string | undefined
    for (const key of Object.keys(deps)) {
      if (key.startsWith('fabric-loader')) {
        loader = 'fabric'
        loaderVersion = deps[key]
      } else if (key.startsWith('forge')) {
        loader = 'forge'
        loaderVersion = deps[key]
      } else if (key.startsWith('neoforge')) {
        loader = 'neoforge'
        loaderVersion = deps[key]
      } else if (key.startsWith('quilt-loader')) {
        loader = 'quilt'
        loaderVersion = deps[key]
      }
    }
    if (!mcVersion) return { ok: false, message: '整合包没有写 Minecraft 版本' }

    const project = makeProject({ name: index.name || '整合包', mcVersion, loader, loaderVersion })
    const root = instanceDir(project)

    // 解压 overrides（资源、配置、模组），按字节报进度
    onProgressExtract(0, 1, 'overrides')
    const ex = extractPackContent(zip as never, root, (done, total, name) => onProgressExtract(done, total, name), shouldAbort)
    if (shouldAbort?.()) {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      return { ok: false, message: '已取消导入' }
    }

    // 下载 index 里列出的文件
    // 每个文件都有多个下载源（forgecdn / modrinth 等）。按「国内实测速度」排序，
    // 避免一直用最慢的那个；sha1 + size 一起传给下载器，重试时可以跳过已完成的文件。
    const prefer = (u: string): number => {
      const h = (() => {
        try {
          return new URL(u).host
        } catch {
          return ''
        }
      })()
      if (h.includes('forgecdn')) return 0
      if (h.includes('modrinth')) return 1
      if (h.includes('github')) return 3
      return 2
    }
    const tasks = (index.files ?? [])
      .filter((f) => f.downloads?.length)
      .map((f) => {
        const urls = [...(f.downloads as string[])].sort((a, b) => prefer(a) - prefer(b))
        return {
          url: urls[0],
          altUrls: urls.slice(1),
          dest: join(root, f.path),
          size: f.fileSize || 0,
          sha1: (f as { hashes?: { sha1?: string } }).hashes?.sha1
        }
      })
      // 大文件先下：否则最后只剩一个 300MB 的文件，看起来像"卡住不动"
      .sort((a, b) => (b.size || 0) - (a.size || 0))
    const totalBytes = tasks.reduce((s, t) => s + (t.size || 0), 0)
    let doneBytes = 0
    if (tasks.length) {
      const { downloadAll } = await import('./http')
      try {
        // 提速：不再按 16 个分批（每批都要等最慢的那个），改成一次性全量、24 并发
        const failed = await downloadAll(tasks, {
          concurrency: 24,
          signal,
          onProgress: (_d, _t, bytes) =>
            onProgress?.({ stage: 'download', done: doneBytes + (bytes || 0), total: totalBytes })
        })
        doneBytes = totalBytes
        onProgress?.({ stage: 'download', done: doneBytes, total: totalBytes })
        // 失败的再补一轮（单文件并发 4，避免又被拖死）
        if (failed.length) {
          await downloadAll(failed, { concurrency: 4, signal })
        }
      } catch (e) {
        // 中止：把已经解压出来的半成品目录整套删掉
        try {
          rmSync(root, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
        return { ok: false, message: e instanceof Error ? e.message : '已取消导入' }
      }
    }
    // 完整性检查：声明的每个文件都应该真的存在且不是空文件
    {
      let bad = 0
      for (const t of tasks) {
        try {
          const st = require('fs').statSync(t.dest)
          if (st.size < 1024) bad++
        } catch {
          bad++
        }
      }
      if (bad > 0) onProgress?.({ stage: 'download', done: totalBytes, total: totalBytes })
    }
    return { ok: true, projectId: project.id, name: project.name, mcVersion, loader, extractedMods: ex.mods }
  }

  // CurseForge 整合包：manifest.json（minecraft.version + modLoaders + files[projectID/fileID]）
  const cfEntry = zip.getEntry('manifest.json')
  if (cfEntry) {
    let manifest: {
      name?: string
      minecraft?: { version?: string; modLoaders?: { id?: string; primary?: boolean }[] }
      files?: { projectID?: number; fileID?: number; required?: boolean }[]
    } = {}
    try {
      manifest = JSON.parse(cfEntry.getData().toString('utf8')) as typeof manifest
    } catch {
      return { ok: false, message: 'manifest.json 解析失败' }
    }
    const mcVersion = manifest.minecraft?.version || ''
    if (!mcVersion) return { ok: false, message: '整合包没有写 Minecraft 版本' }
    const loaderId = (manifest.minecraft?.modLoaders ?? []).find((m) => m.primary)?.id
      || manifest.minecraft?.modLoaders?.[0]?.id
      || ''
    const [loaderName, loaderVer] = loaderId.split('-')
    const loader = ['forge', 'neoforge', 'fabric', 'quilt'].includes(loaderName) ? loaderName : 'vanilla'

    const project = makeProject({
      name: manifest.name || '导入的整合包',
      mcVersion,
      loader,
      loaderVersion: loaderVer || undefined
    })
    const root = instanceDir(project)

    const ex = extractPackContent(zip as never, root, (done, total) => onProgressExtract(done, total), shouldAbort)
    if (shouldAbort?.()) {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      return { ok: false, message: '已取消导入' }
    }

    // CurseForge 只给 projectID/fileID，需要按 ID 解析下载地址（可配置代理或自备 API Key）
    const cfFiles = (manifest.files ?? [])
      .filter((f) => f.projectID && f.fileID)
      .map((f) => ({ projectId: f.projectID as number, fileId: f.fileID as number }))
    return {
      ok: true,
      projectId: project.id,
      name: project.name,
      mcVersion,
      loader,
      extractedMods: ex.mods,
      missingMods: Math.max(0, cfFiles.length - ex.mods),
      cfFiles
    }
  }
  // Rainbow 自己导出的包
  const metaEntry = zip.getEntry('rainbow-pack.json')
  if (metaEntry) {
    const meta = JSON.parse(metaEntry.getData().toString('utf8')) as {
      name?: string
      mcVersion?: string
      versionId?: string
      loader?: string
      loaderVersion?: string
    }
    const project = makeProject({
      name: meta.name || '导入的整合包',
      mcVersion: meta.mcVersion || '1.20.1',
      loader: meta.loader || 'vanilla',
      loaderVersion: meta.loaderVersion
    })
    const root = instanceDir(project)
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue
      if (entry.entryName === 'rainbow-pack.json') continue
      const target = join(root, entry.entryName)
      mkdirSync(join(target, '..'), { recursive: true })
      require('fs').writeFileSync(target, entry.getData())
    }
    return { ok: true, projectId: project.id, name: project.name, mcVersion: project.mcVersion, loader: project.loader }
  }

  return { ok: false, message: '无法识别的整合包格式（需要 .mrpack 或本启动器导出的 zip）' }
}

/** 把实例导出成整合包 zip：mods + config + options.txt */
export function exportInstance(project: GameProject): { ok: boolean; path?: string; message?: string } {
  const src = gameDir(project)
  const outDir = join(paths.root(), 'exports')
  mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const safe = project.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  const out = join(outDir, `${safe}-${stamp}.zip`)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AdmZip = require('adm-zip') as typeof import('adm-zip')
    const zip = new AdmZip()
    for (const sub of ['mods', 'config', 'defaultconfigs', 'shaderpacks', 'resourcepacks']) {
      const p = join(src, sub)
      if (existsSync(p)) zip.addLocalFolder(p, sub)
    }
    const opts = join(src, 'options.txt')
    if (existsSync(opts)) zip.addLocalFile(opts, '')
    zip.addFile(
      'rainbow-pack.json',
      Buffer.from(
        JSON.stringify(
          {
            name: project.name,
            mcVersion: project.mcVersion,
            versionId: project.versionId,
            loader: project.loader,
            loaderVersion: project.loaderVersion,
            exportedAt: new Date().toISOString()
          },
          null,
          2
        ),
        'utf8'
      )
    )
    zip.writeZip(out)
    return { ok: true, path: out }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
