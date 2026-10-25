import { join } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { paths } from '../paths'
import { state as getState, updateSettings, setProjects, setActive, persist } from '../store'
import { checkMods } from './modcheck'
import { projectSummary } from './stats'
import { buildFeedbackZip } from './feedback'
import { testMirrors, cacheSizes, clearCache } from './mirrortest'
import { searchProjects } from './modrinth'
import { hardware } from './sysinfo'
import { app } from 'electron'
import { readdirSync as rd } from 'fs'
import type { GameProject } from '@shared/types'

/**
 * 启动器主控台（Ctrl+K）的命令注册表。
 *
 * 设计目标：像 PowerShell 一样能查到、能改、能解释。
 *   · 每条命令都有 help、参数说明、示例
 *   · 输出是结构化行（文本 / 表格 / 键值 / 图表 / 错误），渲染层统一画
 *   · 所有写操作都落到 store，和 UI 完全等价（改完 UI 立即同步）
 */

export type OutLine =
  | { kind: 'text'; text: string }
  | { kind: 'dim'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'warn'; text: string }
  | { kind: 'err'; text: string }
  | { kind: 'kv'; pairs: [string, string][] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'bar'; items: { label: string; value: number; unit?: string }[] }

export interface CmdResult {
  ok: boolean
  lines: OutLine[]
}

interface Cmd {
  name: string
  group: string
  usage: string
  desc: string
  examples: string[]
  run: (args: string[]) => Promise<CmdResult> | CmdResult
}

const ok = (lines: OutLine[]): CmdResult => ({ ok: true, lines })
const fail = (text: string): CmdResult => ({ ok: false, lines: [{ kind: 'err', text }] })

/* ─────────── 工具 ─────────── */

function fmtMb(mb: number): string {
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB'
  return mb.toFixed(mb < 10 ? 1 : 0) + ' MB'
}

function fmtMs(ms?: number): string {
  if (!ms) return '—'
  const s = ms / 1000
  if (s < 60) return s.toFixed(1) + 's'
  const m = Math.floor(s / 60)
  return `${m}m${Math.round(s - m * 60)}s`
}

function pickProject(key?: string): GameProject | undefined {
  const s = getState()
  if (!key) return s.projects.find((p) => p.id === s.activeProjectId) ?? s.projects[0]
  const k = key.toLowerCase()
  return (
    s.projects.find((p) => p.id === key) ??
    s.projects.find((p) => p.name.toLowerCase() === k) ??
    s.projects.find((p) => p.name.toLowerCase().includes(k)) ??
    s.projects.find((p) => (p.dir ?? '').toLowerCase() === k)
  )
}

function splitArgs(raw: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/* ─────────── 命令表 ─────────── */

const CMDS: Cmd[] = [
  /* 帮助 */
  {
    name: 'help',
    group: '基础',
    usage: 'help [命令]',
    desc: '列出全部命令，或查看某条命令的详细说明',
    examples: ['help', 'help config.set'],
    run: (a) => {
      if (a[0]) {
        const c = CMDS.find((x) => x.name === a[0])
        if (!c) return fail(`没有这条命令：${a[0]}`)
        return ok([
          { kind: 'text', text: `${c.name} — ${c.desc}` },
          { kind: 'kv', pairs: [['分组', c.group], ['用法', c.usage]] },
          { kind: 'dim', text: '示例：' + c.examples.map((e) => `  ${e}`).join('\n      ') }
        ])
      }
      const groups = [...new Set(CMDS.map((c) => c.group))]
      const lines: OutLine[] = []
      for (const g of groups) {
        lines.push({ kind: 'text', text: `【${g}】` })
        for (const c of CMDS.filter((x) => x.group === g)) {
          lines.push({ kind: 'dim', text: `  ${c.name.padEnd(22)} ${c.desc}` })
        }
      }
      return ok(lines)
    }
  },
  {
    name: 'version',
    group: '基础',
    usage: 'version',
    desc: '显示启动器版本与构建时间',
    examples: ['version'],
    run: () =>
      ok([
        {
          kind: 'kv',
          pairs: [
            ['启动器', app.getVersion()],
            ['Electron', process.versions.electron],
            ['Chrome', process.versions.chrome],
            ['Node', process.versions.node]
          ]
        }
      ])
  },
  {
    name: 'echo',
    group: '基础',
    usage: 'echo <文本>',
    desc: '原样输出，用来测试控制台',
    examples: ['echo hello'],
    run: (a) => ok([{ kind: 'text', text: a.join(' ') }])
  },

  /* 项目 */
  {
    name: 'project.list',
    group: '项目',
    usage: 'project.list',
    desc: '列出全部项目与规模',
    examples: ['project.list'],
    run: () => {
      const s = getState()
      const rows = s.projects.map((p) => {
        const sum = projectSummary(p)
        return [
          p.name,
          p.mcVersion,
          `${p.loader}${p.loaderVersion ? ' ' + p.loaderVersion : ''}`,
          String(sum.mods),
          fmtMb(sum.totalMb),
          fmtMs(p.lastBootMs)
        ]
      })
      return ok([
        { kind: 'table', head: ['项目', 'MC', '加载器', '模组', '体积', '上次启动'], rows },
        { kind: 'dim', text: `共 ${rows.length} 个项目 · 当前：${pickProject()?.name ?? '无'}` }
      ])
    }
  },
  {
    name: 'project.use',
    group: '项目',
    usage: 'project.use <名称|ID>',
    desc: '切换当前项目',
    examples: ['project.use 侏罗纪'],
    run: (a) => {
      if (!a[0]) return fail('用法：project.use <名称|ID>')
      const p = pickProject(a.join(' '))
      if (!p) return fail(`找不到项目：${a.join(' ')}`)
      setActive({ activeProjectId: p.id })
      persist()
      return ok([{ kind: 'ok', text: `已切换到「${p.name}」` }])
    }
  },
  {
    name: 'project.rename',
    group: '项目',
    usage: 'project.rename <名称|ID> <新名字>',
    desc: '重命名项目',
    examples: ['project.rename 侏罗纪 侏罗纪公园'],
    run: (a) => {
      if (a.length < 2) return fail('用法：project.rename <名称|ID> <新名字>')
      const p = pickProject(a[0])
      if (!p) return fail(`找不到项目：${a[0]}`)
      const newName = a.slice(1).join(' ')
      setProjects(getState().projects.map((x) => (x.id === p.id ? { ...x, name: newName } : x)))
      persist()
      return ok([{ kind: 'ok', text: `「${p.name}」→「${newName}」` }])
    }
  },
  {
    name: 'project.summary',
    group: '项目',
    usage: 'project.summary [名称|ID]',
    desc: '查看项目构成（体积/模组/光影/存档/启动耗时）',
    examples: ['project.summary', 'project.summary 侏罗纪'],
    run: (a) => {
      const p = pickProject(a.join(' '))
      if (!p) return fail('没有可用项目')
      const sum = projectSummary(p)
      return ok([
        { kind: 'text', text: p.name },
        {
          kind: 'kv',
          pairs: [
            ['MC / 加载器', `${p.mcVersion} · ${p.loader} ${p.loaderVersion ?? ''}`],
            ['versionId', p.versionId ?? '（未设置）'],
            ['内存', p.memoryMb ? fmtMb(p.memoryMb) : '跟随全局'],
            ['模组 / 光影 / 资源包 / 存档', `${sum.mods} / ${sum.shaders} / ${sum.resourcePacks} / ${sum.saves}`],
            ['总体积', fmtMb(sum.totalMb)],
            ['上次 / 最快启动', `${fmtMs(p.lastBootMs)} / ${fmtMs(p.bestBootMs)}`],
            ['启动次数', String(p.launchCount ?? 0)]
          ]
        },
        { kind: 'bar', items: sum.breakdown.filter((b) => b.mb >= 1).map((b) => ({ label: b.label, value: b.mb, unit: 'MB' })) }
      ])
    }
  },
  {
    name: 'project.check',
    group: '项目',
    usage: 'project.check [名称|ID]',
    desc: '模组体检：重复 modid / 缺前置 / 版本不符',
    examples: ['project.check'],
    run: async (a) => {
      const p = pickProject(a.join(' '))
      if (!p) return fail('没有可用项目')
      const r = checkMods(p)
      const lines: OutLine[] = [
        {
          kind: 'dim',
          text: `${r.jars} 个 jar，识别 ${r.mods} 个模组，用时 ${r.elapsedMs} ms`
        }
      ]
      if (!r.issues.length) lines.push({ kind: 'ok', text: '未发现问题' })
      for (const it of r.issues.slice(0, 20)) {
        lines.push({ kind: it.level === 'error' ? 'err' : 'warn', text: `[${it.kind}] ${it.title}` })
        lines.push({ kind: 'dim', text: `        ${it.detail}${it.files ? '｜' + it.files.slice(0, 3).join(', ') : ''}` })
      }
      return { ok: r.ok, lines }
    }
  },
  {
    name: 'project.feedback',
    group: '项目',
    usage: 'project.feedback [名称|ID]',
    desc: '生成崩溃/问题反馈 zip 并打开所在文件夹',
    examples: ['project.feedback'],
    run: (a) => {
      const p = pickProject(a.join(' '))
      const r = buildFeedbackZip(p)
      if (!r.ok) return fail(r.message || '打包失败')
      return ok([
        { kind: 'ok', text: `已生成：${r.path}` },
        { kind: 'dim', text: `大小 ${r.sizeMb} MB（含日志、崩溃报告、系统信息、体检结果，用户名已脱敏）` }
      ])
    }
  },
  {
    name: 'project.remove',
    group: '项目',
    usage: 'project.remove <名称|ID>',
    desc: '删除项目（会删掉该项目目录，慎用）',
    examples: ['project.remove 测试项目'],
    run: (a) => {
      const p = pickProject(a.join(' '))
      if (!p) return fail('找不到项目')
      if (getState().projects.length <= 1) return fail('这是最后一个项目，不能删')
      const dir = join(paths.games(), p.dir)
      const { rmSync } = require('fs') as typeof import('fs')
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      const rest = getState().projects.filter((x) => x.id !== p.id)
      setProjects(rest)
      if (getState().activeProjectId === p.id) setActive({ activeProjectId: rest[0]?.id })
      persist()
      return ok([{ kind: 'warn', text: `已删除「${p.name}」与目录 ${dir}` }])
    }
  },

  /* 配置 */
  {
    name: 'config.list',
    group: '配置',
    usage: 'config.list [关键词]',
    desc: '列出所有可配置项（可带关键词过滤）',
    examples: ['config.list', 'config.list memory'],
    run: (a) => {
      const s = getState().settings as unknown as Record<string, unknown>
      const kw = (a[0] ?? '').toLowerCase()
      const rows = Object.entries(s)
        .filter(([k]) => !kw || k.toLowerCase().includes(kw))
        .map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v)])
      return ok([
        { kind: 'table', head: ['键', '当前值'], rows },
        { kind: 'dim', text: '改值：config.set <键> <值>（布尔写 true/false，数字直接写）' }
      ])
    }
  },
  {
    name: 'config.get',
    group: '配置',
    usage: 'config.get <键>',
    desc: '读取一个配置项',
    examples: ['config.get maxMemoryMb'],
    run: (a) => {
      if (!a[0]) return fail('用法：config.get <键>')
      const v = (getState().settings as unknown as Record<string, unknown>)[a[0]]
      if (v === undefined) return fail(`没有这个配置项：${a[0]}（用 config.list 看看有哪些）`)
      return ok([{ kind: 'kv', pairs: [[a[0], typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)]] }])
    }
  },
  {
    name: 'config.set',
    group: '配置',
    usage: 'config.set <键> <值>',
    desc: '修改一个配置项（与设置页等价）',
    examples: ['config.set maxMemoryMb 8192', 'config.set downloadSource bmclapi'],
    run: (a) => {
      if (a.length < 2) return fail('用法：config.set <键> <值>')
      const key = a[0]
      const settings = getState().settings as unknown as Record<string, unknown>
      if (!(key in settings)) return fail(`没有这个配置项：${key}`)
      const prev = settings[key]
      let value: unknown = a.slice(1).join(' ')
      if (typeof prev === 'boolean') value = String(value) === 'true' || String(value) === '1'
      else if (typeof prev === 'number') {
        const n = Number(value)
        if (Number.isNaN(n)) return fail('这个配置项要填数字')
        value = n
      }
      updateSettings({ [key]: value } as never)
      persist()
      return ok([{ kind: 'ok', text: `${key}: ${JSON.stringify(prev)} → ${JSON.stringify(value)}` }])
    }
  },
  {
    name: 'memory.set',
    group: '配置',
    usage: 'memory.set <MB|auto>',
    desc: '设置当前项目的内存（auto = 按模组自动）',
    examples: ['memory.set 8192', 'memory.set auto'],
    run: (a) => {
      const p = pickProject()
      if (!p) return fail('没有可用项目')
      const v = a[0]
      if (!v) return fail('用法：memory.set <MB|auto>')
      const patch =
        v === 'auto'
          ? { memoryMb: undefined, memoryMode: 'auto' as const }
          : { memoryMb: Number(v), memoryMode: 'custom' as const }
      if (v !== 'auto' && Number.isNaN(patch.memoryMb)) return fail('要填数字，例如 8192')
      setProjects(getState().projects.map((x) => (x.id === p.id ? { ...x, ...patch } : x)))
      persist()
      return ok([{ kind: 'ok', text: `「${p.name}」内存：${v === 'auto' ? '自动' : fmtMb(Number(v))}` }])
    }
  },
  {
    name: 'source.set',
    group: '配置',
    usage: 'source.set <official|bmclapi>',
    desc: '切换下载源',
    examples: ['source.set bmclapi'],
    run: (a) => {
      const v = a[0]
      if (v !== 'official' && v !== 'bmclapi') return fail('只支持 official 或 bmclapi')
      updateSettings({ downloadSource: v === 'bmclapi' ? 'mirror' : 'official' })
      persist()
      return ok([{ kind: 'ok', text: `下载源已切到 ${v}` }])
    }
  },
  {
    name: 'mirror.test',
    group: '配置',
    usage: 'mirror.test',
    desc: '测速对比官方直连与 BMCLAPI，并给出推荐',
    examples: ['mirror.test'],
    run: async () => {
      const r = await testMirrors()
      return ok([
        {
          kind: 'table',
          head: ['源', '延迟', '速度', '状态'],
          rows: r.results.map((x) => [
            x.label,
            `${x.latencyMs} ms`,
            x.speedMbs ? `${x.speedMbs} MB/s` : '—',
            x.ok ? '可用' : x.error || '失败'
          ])
        },
        { kind: 'ok', text: `推荐：${r.recommend === 'bmclapi' ? 'BMCLAPI 镜像' : '官方直连'}` }
      ])
    }
  },

  /* 缓存 */
  {
    name: 'cache.list',
    group: '缓存',
    usage: 'cache.list',
    desc: '查看各类缓存占用',
    examples: ['cache.list'],
    run: () =>
      ok([
        {
          kind: 'table',
          head: ['缓存', '占用'],
          rows: cacheSizes().map((c) => [c.label, fmtMb(c.mb)])
        }
      ])
  },
  {
    name: 'cache.clear',
    group: '缓存',
    usage: 'cache.clear <cfwidget|logs|exports>',
    desc: '清空指定缓存并显示释放空间',
    examples: ['cache.clear logs'],
    run: (a) => {
      const key = a[0]
      if (!key) return fail('用法：cache.clear <cfwidget|logs|exports>')
      const r = clearCache(key)
      if (!r.ok) return fail('未知缓存类型')
      return ok([{ kind: 'ok', text: `已清空 ${key}，释放 ${fmtMb(r.freedMb)}` }])
    }
  },

  /* 统计（Power BI 风格） */
  {
    name: 'stats.overview',
    group: '统计',
    usage: 'stats.overview',
    desc: '全局概览：项目数、模组总数、占用总量、启动健康度',
    examples: ['stats.overview'],
    run: () => {
      const s = getState()
      let mods = 0
      let size = 0
      let boots: number[] = []
      for (const p of s.projects) {
        const sum = projectSummary(p)
        mods += sum.mods
        size += sum.totalMb
        if (p.lastBootMs) boots.push(p.lastBootMs)
      }
      const avgBoot = boots.length ? boots.reduce((a, b) => a + b, 0) / boots.length : 0
      const healthy = s.projects.filter((p) => checkOk(p)).length
      return ok([
        {
          kind: 'kv',
          pairs: [
            ['项目数', String(s.projects.length)],
            ['模组总数', String(mods)],
            ['占用总量', fmtMb(size)],
            ['平均启动', fmtMs(avgBoot)],
            ['体检通过', `${healthy} / ${s.projects.length}`],
            ['账号数', String(s.accounts.length)]
          ]
        },
        { kind: 'bar', items: s.projects.map((p) => ({ label: p.name.slice(0, 8), value: projectSummary(p).totalMb, unit: 'MB' })) }
      ])
    }
  },
  {
    name: 'stats.boot',
    group: '统计',
    usage: 'stats.boot',
    desc: '各项目启动耗时排行（上次 / 最快 / 次数）',
    examples: ['stats.boot'],
    run: () => {
      const rows = getState()
        .projects.slice()
        .sort((a, b) => (b.lastBootMs ?? 0) - (a.lastBootMs ?? 0))
        .map((p) => [p.name, fmtMs(p.lastBootMs), fmtMs(p.bestBootMs), String(p.launchCount ?? 0)])
      return ok([{ kind: 'table', head: ['项目', '上次', '最快', '次数'], rows }])
    }
  },
  {
    name: 'stats.size',
    group: '统计',
    usage: 'stats.size',
    desc: '各项目体积排行（含构成）',
    examples: ['stats.size'],
    run: () => {
      const items = getState()
        .projects.map((p) => ({ label: p.name.slice(0, 10), value: projectSummary(p).totalMb, unit: 'MB' }))
        .sort((a, b) => b.value - a.value)
      const rows = getState().projects.map((p) => {
        const sum = projectSummary(p)
        return [p.name, fmtMb(sum.totalMb), String(sum.mods), fmtMb(sum.saves ? sum.breakdown.find((b) => b.key === 'saves')?.mb ?? 0 : 0)]
      })
      return ok([{ kind: 'bar', items }, { kind: 'table', head: ['项目', '体积', '模组', '存档'], rows }])
    }
  },
  {
    name: 'stats.crash',
    group: '统计',
    usage: 'stats.crash [项目]',
    desc: '统计崩溃报告数量与最近一次崩溃时间',
    examples: ['stats.crash'],
    run: (a) => {
      const targets = a.length ? [pickProject(a.join(' '))].filter(Boolean) as GameProject[] : getState().projects
      const rows: string[][] = []
      for (const p of targets) {
        const dir = join(paths.games(), p.dir, 'crash-reports')
        let count = 0
        let latest = '—'
        try {
          const files = rd(dir).filter((f) => f.endsWith('.txt'))
          count = files.length
          if (files.length) {
            const times = files.map((f) => statSync(join(dir, f)).mtimeMs).sort((x, y) => y - x)
            latest = new Date(times[0]).toLocaleString('zh-CN')
          }
        } catch {
          /* ignore */
        }
        rows.push([p.name, String(count), latest])
      }
      return ok([{ kind: 'table', head: ['项目', '崩溃报告', '最近一次'], rows }])
    }
  },

  /* 系统 */
  {
    name: 'sys.info',
    group: '系统',
    usage: 'sys.info',
    desc: 'CPU / 内存 / 显卡 / 系统',
    examples: ['sys.info'],
    run: () => {
      const hw = hardware()
      return ok([
        {
          kind: 'kv',
          pairs: [
            ['CPU', `${hw.cpuModel}（${hw.cpuCores} 核）`],
            ['内存', `${(hw.totalRamMb / 1024).toFixed(0)} GB（可用 ${(hw.freeRamMb / 1024).toFixed(0)} GB）`],
            ['显卡', `${hw.gpuName}${hw.gpuVramMb ? `（${(hw.gpuVramMb / 1024).toFixed(1)} GB）` : ''}`],
            ['系统', process.getSystemVersion?.() ?? process.platform]
          ]
        }
      ])
    }
  },
  {
    name: 'export.json',
    group: '系统',
    usage: 'export.json',
    desc: '把全局状态（不含令牌）导出到 data/exports 下的 json',
    examples: ['export.json'],
    run: () => {
      const s = getState()
      const safe = {
        version: app.getVersion(),
        settings: s.settings,
        projects: s.projects.map((p) => ({ ...p, ...projectSummary(p) })),
        accounts: s.accounts.map((a) => ({ id: a.id, name: a.name, mode: a.mode }))
      }
      const dir = join(paths.root(), 'exports')
      const { mkdirSync, writeFileSync } = require('fs') as typeof import('fs')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `state-${Date.now()}.json`)
      writeFileSync(file, JSON.stringify(safe, null, 2), 'utf8')
      return ok([{ kind: 'ok', text: `已导出：${file}` }])
    }
  }
]

function checkOk(p: GameProject): boolean {
  try {
    const r = checkMods(p)
    return r.issues.filter((i) => i.level === 'error').length === 0
  } catch {
    return false
  }
}

/* ─────────── 执行 ─────────── */

export function listCommands(): { name: string; group: string; usage: string; desc: string }[] {
  return CMDS.map((c) => ({ name: c.name, group: c.group, usage: c.usage, desc: c.desc }))
}

export async function runCommand(input: string): Promise<CmdResult> {
  const raw = input.trim()
  if (!raw) return ok([])
  if (raw === 'clear' || raw === 'cls') return ok([])
  const [head, ...rest] = splitArgs(raw)
  const cmd = CMDS.find((c) => c.name.toLowerCase() === head.toLowerCase())
  if (!cmd) {
    const guess = CMDS.filter((c) => c.name.toLowerCase().startsWith(head.toLowerCase().slice(0, 3))).slice(0, 5)
    return fail(
      `没有这条命令：${head}` + (guess.length ? `\n你是不是想用：${guess.map((g) => g.name).join('、')}（help 查看全部）` : '\n输入 help 查看全部命令')
    )
  }
  try {
    return await cmd.run(rest)
  } catch (e) {
    return fail(`执行出错：${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 供控制台补全使用：只回命令名 + 分组 */
export function completionList(): string[] {
  return CMDS.map((c) => c.name)
}
