import AdmZip from 'adm-zip'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { paths } from '../paths'
import type { GameProject } from '@shared/types'

/**
 * 模组体检：**不启动游戏**，直接读每个 jar 的元数据，找出静态就能判断的问题。
 *
 * 检查项：
 *   ① 重复 modid —— 同一个模组装了两份（最常见崩溃原因）
 *   ② 缺前置 —— 声明的 mandatory 依赖没装
 *   ③ MC 版本不匹配 —— 元数据里声明的版本范围与项目版本不符
 *   ④ mods 目录里的无效文件（不是 jar / 不是模组）
 */

export interface ModIssue {
  kind: 'duplicate' | 'missingDep' | 'version' | 'invalid'
  level: 'error' | 'warn'
  title: string
  detail: string
  files?: string[]
}

export interface ModCheckResult {
  ok: boolean
  jars: number
  mods: number
  issues: ModIssue[]
  elapsedMs: number
}

interface JarMeta {
  file: string
  ids: string[]
  name?: string
  version?: string
  /** 依赖：modId → { mandatory, range } */
  deps: Record<string, { mandatory: boolean; range: string }>
  /** 声明的 mc 版本范围（fabric 才有明确值） */
  mcRange?: string
}

function readText(zip: AdmZip, name: string): string | null {
  try {
    const e = zip.getEntry(name)
    return e ? e.getData().toString('utf8') : null
  } catch {
    return null
  }
}

/** 解析 Forge / NeoForge 的 mods.toml（按段落解析，避免把依赖块里的 modId 当成模组 ID） */
function parseToml(txt: string): JarMeta | null {
  const ids: string[] = []
  const deps: JarMeta['deps'] = {}
  let name: string | undefined
  let version: string | undefined

  type Section = { kind: 'top' } | { kind: 'dep'; owner: string }
  let section: Section = { kind: 'top' }
  let currentDep: string | null = null

  const unquote = (v: string): string => {
    const t = v.trim()
    const quoted = t.match(/^(["'])(.*?)\1/)
    if (quoted) return quoted[2].trim()
    const hash = t.indexOf('#')
    return (hash >= 0 ? t.slice(0, hash) : t).trim()
  }

  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    // 段落切换
    const depHeader = line.match(/^\[\[\s*dependencies\.([^\]]+)\s*\]\]/i)
    if (depHeader) {
      section = { kind: 'dep', owner: depHeader[1].trim() }
      currentDep = null
      continue
    }
    if (/^\[[^\]]+\]/.test(line)) {
      section = { kind: 'top' }
      currentDep = null
      continue
    }

    const kv = line.match(/^([A-Za-z0-9_.]+)\s*=\s*(.+)$/)
    if (!kv) continue
    const key = kv[1]
    let value = kv[2].trim()
    // 去掉行尾注释
    if (!value.startsWith('[') && !value.startsWith('{')) {
      const hash = value.indexOf('#')
      if (hash > 0 && !value.slice(0, hash).includes('"')) value = value.slice(0, hash).trim()
    }

    if (section.kind === 'top') {
      if (key === 'modId') {
        const id = unquote(value)
        if (id) ids.push(id)
      } else if (key === 'version' && !version) {
        version = unquote(value)
      } else if (key === 'displayName' && !name) {
        name = unquote(value)
      }
      continue
    }

    // 依赖段
    if (key === 'modId') {
      currentDep = unquote(value)
    } else if (currentDep && (key === 'mandatory' || key === 'versionRange')) {
      const prev = deps[currentDep] ?? { mandatory: true, range: '' }
      if (key === 'mandatory') prev.mandatory = value.startsWith('true')
      else prev.range = unquote(value)
      deps[currentDep] = prev
    }
  }

  if (!ids.length) return null
  return { file: '', ids, name, version, deps }
}

function parseFabric(txt: string): JarMeta | null {
  try {
    const j = JSON.parse(txt) as {
      id?: string
      name?: string
      version?: string
      depends?: Record<string, string | string[]>
    }
    if (!j.id) return null
    const deps: JarMeta['deps'] = {}
    for (const [k, v] of Object.entries(j.depends ?? {})) {
      deps[k] = { mandatory: true, range: Array.isArray(v) ? v.join(' || ') : String(v) }
    }
    return {
      file: '',
      ids: [j.id],
      name: j.name,
      version: j.version,
      deps,
      mcRange: typeof j.depends?.minecraft === 'string' ? (j.depends.minecraft as string) : undefined
    }
  } catch {
    return null
  }
}

const IGNORED_DEPS = new Set([
  'minecraft',
  'forge',
  'neoforge',
  'fabricloader',
  'fabric',
  'fabric-api',
  'java',
  'curios',
  'geckolib',
  'cloth-config',
  'cloth_config'
])

/** 粗略判断版本范围是否包含某个 MC 版本（支持 [1.20,1.21) 与 1.20.1 这类写法） */
function rangeIncludes(range: string, mcVersion: string): boolean {
  if (!range) return true
  const v = range.replace(/\s/g, '')
  if (v.includes('||')) return v.split('||').some((part) => rangeIncludes(part, mcVersion))
  // fabric 风格：>=1.20 <1.21
  if (/^[<>]=?/.test(v)) {
    const tests = v.split(/(?=[<>])/).filter(Boolean)
    return tests.every((t) => {
      const m = t.match(/^([<>]=?)([\d.]+)$/)
      if (!m) return true
      const cmp = compareVer(mcVersion, m[2])
      if (m[1] === '>') return cmp > 0
      if (m[1] === '>=') return cmp >= 0
      if (m[1] === '<') return cmp < 0
      return cmp <= 0
    })
  }
  // maven 风格：[1.20,1.21)
  if (v.startsWith('[') || v.startsWith('(')) {
    const inner = v.replace(/^[[(]/, '').replace(/[)\]]$/, '')
    const [lo, hi] = inner.split(',')
    const loOk = !lo || compareVer(mcVersion, lo) >= 0
    const hiOk = !hi || compareVer(mcVersion, hi) < 1
    return loOk && hiOk
  }
  // 精确或前缀匹配：1.20.1 / 1.20.x / 1.20
  if (v.includes('x')) return mcVersion.startsWith(v.replace(/x/g, '').replace(/\.$/, ''))
  return v === mcVersion || mcVersion.startsWith(v + '.') || v.startsWith(mcVersion)
}

function compareVer(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export function checkMods(project: GameProject): ModCheckResult {
  const t0 = Date.now()
  const modsDir = join(paths.games(), project.dir, 'mods')
  const issues: ModIssue[] = []
  const metas: JarMeta[] = []
  const unknownJars: string[] = []
  const provided = new Set<string>()
  let invalid = 0

  let files: string[] = []
  try {
    files = readdirSync(modsDir)
  } catch {
    return { ok: false, jars: 0, mods: 0, issues: [{ kind: 'invalid', level: 'error', title: '找不到 mods 目录', detail: modsDir }], elapsedMs: 0 }
  }

  const jarFiles = files.filter((f) => f.toLowerCase().endsWith('.jar'))
  for (const f of files) {
    if (f.toLowerCase().endsWith('.jar')) continue
    if (f.toLowerCase().endsWith('.zip')) {
      issues.push({
        kind: 'invalid',
        level: 'warn',
        title: 'mods 目录里有 zip 文件',
        detail: '光影包要放 shaderpacks，资源包要放 resourcepacks；放在 mods 里不会生效',
        files: [f]
      })
    }
  }

  for (const f of jarFiles) {
    const full = join(modsDir, f)
    let zip: AdmZip
    try {
      if (statSync(full).size < 1024) {
        invalid++
        issues.push({ kind: 'invalid', level: 'error', title: '文件过小，可能没下载完整', detail: '重新导入整合包可补回', files: [f] })
        continue
      }
      zip = new AdmZip(full)
    } catch {
      // 常见于 jar 内文件名是 GBK 编码（adm-zip 会报 Invalid filename），
      // 这类 jar 游戏能正常读，不算错误，只记入「无法识别」
      unknownJars.push(f)
      continue
    }

    let meta: JarMeta | null = null
    const toml = readText(zip, 'META-INF/neoforge.mods.toml') ?? readText(zip, 'META-INF/mods.toml')
    if (toml) meta = parseToml(toml)
    if (!meta) {
      const fj = readText(zip, 'fabric.mod.json')
      if (fj) meta = parseFabric(fj)
    }
    if (!meta) {
      // 前置库 / 兼容层 / 语言注入器，没有 mods.toml 很正常
      unknownJars.push(f)
      continue
    }
    meta.file = f
    // jar-in-jar：很多「前置」被打包在模组内部，直接去 META-INF/jarjar 里找
    try {
      for (const e of zip.getEntries()) {
        if (!/^META-INF\/jarjar\/.*\.jar$/i.test(e.entryName) && !/^META-INF\/jars\/.*\.jar$/i.test(e.entryName)) continue
        try {
          const inner = new AdmZip(e.getData())
          const it = readText(inner, 'META-INF/neoforge.mods.toml') ?? readText(inner, 'META-INF/mods.toml')
          if (it) {
            const im = parseToml(it)
            if (im) for (const id of im.ids) provided.add(id)
          } else {
            const fj = readText(inner, 'fabric.mod.json')
            if (fj) {
              const im = parseFabric(fj)
              if (im) for (const id of im.ids) provided.add(id)
            }
          }
        } catch {
          /* 内嵌 jar 打不开就跳过 */
        }
      }
    } catch {
      /* ignore */
    }
    metas.push(meta)
  }

  // ① 重复 modid
  const byId = new Map<string, string[]>()
  for (const m of metas) {
    for (const id of m.ids) {
      const arr = byId.get(id) ?? []
      arr.push(m.file)
      byId.set(id, arr)
    }
  }
  for (const [id, list] of byId) {
    if (list.length > 1) {
      issues.push({
        kind: 'duplicate',
        level: 'error',
        title: `两个 jar 声明了同一个 modid：${id}`,
        detail: '多数情况是装了本体 + 附属却都声明了本体 id，或新旧版本并存；删掉多余的那个再启动',
        files: list
      })
    }
  }

  // ② 缺前置
  const installed = new Set(byId.keys())
  const missing = new Map<string, string[]>()
  for (const m of metas) {
    for (const [depId, dep] of Object.entries(m.deps)) {
      if (IGNORED_DEPS.has(depId.toLowerCase())) continue
      if (!dep.mandatory) continue
      if (installed.has(depId) || provided.has(depId)) continue
      const norm = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]/g, '')
      const depNorm = norm(depId)
      const byName = [...installed, ...unknownJars].some((f) => norm(f).includes(depNorm))
      if (byName) continue
      const arr = missing.get(depId) ?? []
      arr.push(m.file)
      missing.set(depId, arr)
    }
  }
  for (const [depId, users] of missing) {
    issues.push({
      kind: 'missingDep',
      level: 'error',
      title: `缺少前置模组：${depId}`,
      detail: `有 ${users.length} 个模组依赖它（${users.slice(0, 3).join('、')}${users.length > 3 ? '…' : ''}），去「下载 → 模组」搜索并安装`,
      files: users
    })
  }

  // ③ MC 版本不匹配
  for (const m of metas) {
    if (!m.mcRange) continue
    if (!rangeIncludes(m.mcRange, project.mcVersion)) {
      issues.push({
        kind: 'version',
        level: 'warn',
        title: `${m.file} 可能不适用 MC ${project.mcVersion}`,
        detail: `它声明支持 ${m.mcRange}，装错了会崩溃或功能缺失`,
        files: [m.file]
      })
    }
  }

  const errors = issues.filter((i) => i.level === 'error').length
  return {
    ok: errors === 0,
    jars: jarFiles.length,
    mods: metas.length,
    issues,
    elapsedMs: Date.now() - t0
  }
}
