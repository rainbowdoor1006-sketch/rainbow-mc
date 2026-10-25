import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { fetchJson } from './http'
import { runtimeDir } from './paths'
import { downloadOne, ensureDir } from './http'

interface AdoptiumAsset {
  binary: { package: { link: string; name: string; size: number } }
  release_name: string
}

/** 按大版本号取 JRE 的下载地址（Adoptium / Eclipse Temurin） */
async function adoptiumUrl(major: number): Promise<{ url: string; name: string }> {
  const api =
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot` +
    `?architecture=x64&image_type=jre&os=windows&vendor=eclipse`
  const list = await fetchJson<AdoptiumAsset[]>(api)
  if (!list.length) throw new Error(`没有找到 Java ${major} 的 JRE`)
  const pkg = list[0].binary.package
  return { url: pkg.link, name: pkg.name }
}

export interface JavaResult {
  path: string
  major: number
  downloaded: boolean
}

/** 找到 jre 目录里的 javaw.exe */
function findJavaExe(root: string): string | null {
  const direct = join(root, 'bin', 'javaw.exe')
  if (existsSync(direct)) return direct
  try {
    for (const name of readdirSync(root)) {
      const candidate = join(root, name, 'bin', 'javaw.exe')
      if (existsSync(candidate)) return candidate
    }
  } catch {
    /* ignore */
  }
  return null
}

export function javaInstallDir(major: number): string {
  return join(runtimeDir(), `jre-${major}`)
}

export function findInstalledJava(major: number): string | null {
  const dir = javaInstallDir(major)
  if (!existsSync(dir)) return null
  return findJavaExe(dir)
}

/**
 * 确保存在指定大版本的 Java 运行时。
 * 已安装直接返回；否则从 Adoptium 下载 JRE 并解压。
 */
export async function ensureJava(
  major: number,
  onProgress?: (stage: 'download' | 'extract', pct: number) => void
): Promise<JavaResult> {
  const existing = findInstalledJava(major)
  if (existing) return { path: existing, major, downloaded: false }

  const dest = javaInstallDir(major)
  ensureDir(runtimeDir())
  mkdirSync(dest, { recursive: true })

  onProgress?.('download', 0)
  const { url, name } = await adoptiumUrl(major)
  const zipPath = join(runtimeDir(), name)
  // 国内直连 GitHub 基本必挂（120 秒超时 ×3 次重试 = 6 分钟没反应），
  // 所以镜像放前面，GitHub 只作为最后的兜底且只试 1 次。
  const mirrors = [
    `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/${major}/jre/x64/windows/${name}`,
    `https://mirror.nju.edu.cn/adoptium/${major}/jre/x64/windows/${name}`
  ]
  let lastErr = ''
  let ok = false
  for (const candidate of [...mirrors, url]) {
    const isGithub = candidate === url
    const r = await downloadOne({ url: candidate, dest: zipPath }, isGithub ? 1 : 2)
    if (r.ok) {
      ok = true
      break
    }
    lastErr = r.error || 'unknown'
  }
  if (!ok) {
    throw new Error(
      `Java ${major} 运行时下载失败：${lastErr}。` +
        `可以手动安装 Java ${major}，然后在「设置 → Java 路径」里指定 javaw.exe。`
    )
  }
  onProgress?.('download', 100)

  onProgress?.('extract', 0)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AdmZip = require('adm-zip') as typeof import('adm-zip')
  const zip = new AdmZip(zipPath)
  zip.extractAllTo(dest, true)
  onProgress?.('extract', 100)

  try {
    rmSync(zipPath, { force: true })
  } catch {
    /* 解压成功即可，删不掉不影响 */
  }

  const exe = findJavaExe(dest)
  if (!exe) throw new Error('Java 运行时解压后没有找到 javaw.exe')
  return { path: exe, major, downloaded: true }
}
