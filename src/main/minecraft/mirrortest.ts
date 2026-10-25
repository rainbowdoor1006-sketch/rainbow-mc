import { join } from 'path'
import { paths } from '../paths'

/**
 * 下载源测速：对「官方直连」与「BMCLAPI 镜像」各取一个真实文件，
 * 测连接延迟（首个字节前的时间）与下载速度（取 512 KB 左右）。
 */

export interface MirrorProbe {
  key: 'official' | 'bmclapi'
  label: string
  /** 连接 + 首字节耗时（ms） */
  latencyMs: number
  /** 折算速度（MB/s），失败为 0 */
  speedMbs: number
  ok: boolean
  error?: string
}

const PROBES: { key: 'official' | 'bmclapi'; label: string; url: string }[] = [
  {
    key: 'official',
    label: '官方直连（Mojang）',
    url: 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'
  },
  {
    key: 'bmclapi',
    label: 'BMCLAPI 镜像',
    url: 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json'
  }
]

async function probe(one: (typeof PROBES)[number], timeoutMs = 12000): Promise<MirrorProbe> {
  const t0 = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(one.url, { signal: ctrl.signal, headers: { 'User-Agent': 'RAINBOWMC' } })
    if (!res.ok || !res.body) {
      clearTimeout(timer)
      return { key: one.key, label: one.label, latencyMs: Date.now() - t0, speedMbs: 0, ok: false, error: `HTTP ${res.status}` }
    }
    const reader = res.body.getReader()
    const first = await reader.read()
    const latencyMs = Date.now() - t0

    const t1 = Date.now()
    let got = first.value?.length ?? 0
    const LIMIT = 512 * 1024
    while (got < LIMIT) {
      const { done, value } = await reader.read()
      if (done) break
      got += value?.length ?? 0
    }
    try {
      await reader.cancel()
    } catch {
      /* ignore */
    }
    clearTimeout(timer)
    const sec = Math.max(0.05, (Date.now() - t1) / 1000)
    return {
      key: one.key,
      label: one.label,
      latencyMs,
      speedMbs: Math.round((got / 1048576 / sec) * 100) / 100,
      ok: true
    }
  } catch (e) {
    return {
      key: one.key,
      label: one.label,
      latencyMs: Date.now() - t0,
      speedMbs: 0,
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

export async function testMirrors(): Promise<{ ok: boolean; results: MirrorProbe[]; recommend: 'official' | 'bmclapi' }> {
  const results = await Promise.all(PROBES.map((p) => probe(p)))
  const scored = results
    .map((r) => ({ r, score: r.ok ? r.speedMbs * 1000 - r.latencyMs : -1 }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]?.r
  return {
    ok: results.some((r) => r.ok),
    results,
    recommend: best && best.ok ? best.key : 'bmclapi'
  }
}

/** 缓存目录体积（用于「清缓存」前后对比） */
export function cacheSizes(): { key: string; label: string; mb: number }[] {
  const targets: { key: string; label: string; dir: string }[] = [
    { key: 'cfwidget', label: 'CurseForge 元数据', dir: join(paths.root(), 'cache', 'cfwidget') },
    { key: 'logs', label: '启动器日志', dir: join(paths.root(), 'logs') },
    { key: 'exports', label: '反馈包', dir: join(paths.root(), 'exports') }
  ]
  const { existsSync, readdirSync, statSync } = require('fs') as typeof import('fs')
  const sum = (dir: string): number => {
    let total = 0
    try {
      for (const f of readdirSync(dir)) {
        try {
          const st = statSync(join(dir, f))
          total += st.isFile() ? st.size : 0
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    return total
  }
  return targets.map((t) => ({
    key: t.key,
    label: t.label,
    mb: Math.round((sum(t.dir) / 1048576) * 10) / 10
  }))
}

export function clearCache(key: string): { ok: boolean; freedMb: number } {
  const map: Record<string, string> = {
    cfwidget: join(paths.root(), 'cache', 'cfwidget'),
    logs: join(paths.root(), 'logs'),
    exports: join(paths.root(), 'exports')
  }
  const dir = map[key]
  if (!dir) return { ok: false, freedMb: 0 }
  const { readdirSync, statSync, rmSync } = require('fs') as typeof import('fs')
  let freed = 0
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      try {
        const st = statSync(p)
        if (st.isFile()) {
          freed += st.size
          rmSync(p, { force: true })
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return { ok: true, freedMb: Math.round((freed / 1048576) * 10) / 10 }
}
