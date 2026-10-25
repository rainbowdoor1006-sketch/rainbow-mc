import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { paths } from '../paths'
import { ZH_NAMES, zhNameFor } from '@shared/zhnames'

/**
 * 中文名来源：MC百科（mcmod.cn，中文 MC 社区权威 wiki）。
 * 搜索结果形如：<a ...>钠 (<em>Sodium</em>)</a> —— 取括号前的中文部分。
 * 结果永久缓存到 cache/zh-cache.json，避免重复请求。
 */

const CACHE_FILE = (): string => join(paths.cache(), 'zh-cache.json')
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

let cache: Record<string, string> | null = null
const inflight = new Map<string, Promise<string | null>>()

function loadCache(): Record<string, string> {
  if (cache) return cache
  try {
    if (existsSync(CACHE_FILE())) cache = JSON.parse(readFileSync(CACHE_FILE(), 'utf-8')) as Record<string, string>
  } catch {
    /* 忽略损坏缓存 */
  }
  if (!cache) cache = {}
  return cache
}

let saveTimer: NodeJS.Timeout | null = null
function saveCacheSoon(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      mkdirSync(paths.cache(), { recursive: true })
      writeFileSync(CACHE_FILE(), JSON.stringify(cache ?? {}, null, 0), 'utf-8')
    } catch {
      /* 写缓存失败不影响功能 */
    }
  }, 1500)
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** 去掉 mcmod 标题里的 [TF] / [AE2] 这类缩写前缀 */
function cleanZh(s: string): string {
  return s.replace(/^\[[^\]]{1,12}\]\s*/, '').trim()
}

/** 从结果锚文本里取「中文名」和「英文名」，形如：钠 (Sodium) */
function parseItem(text: string): { zh: string | null; en: string | null } {
  const clean = text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(clean)
  if (m) {
    const head = cleanZh(m[1])
    const inside = m[2].trim()
    if (/[\u4e00-\u9fff]/.test(head) && /[A-Za-z]/.test(inside)) return { zh: head, en: inside }
    if (/[\u4e00-\u9fff]/.test(inside) && /[A-Za-z]/.test(head)) return { zh: inside, en: head }
  }
  if (/[\u4e00-\u9fff]/.test(clean) && !/[A-Za-z]{3,}/.test(clean)) return { zh: cleanZh(clean), en: null }
  return { zh: null, en: clean }
}

async function fetchSearch(title: string, site: number): Promise<string> {
  const url = `https://search.mcmod.cn/s?key=${encodeURIComponent(title)}&site=${site}`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })
  if (!res.ok) return ''
  return res.text()
}

async function searchMcmod(title: string): Promise<string | null> {
  let html = await fetchSearch(title, 0)
  if (html && !html.includes('class="result-item"')) {
    html = await fetchSearch(title, 1)
  }
  // 带撇号 / 符号的名字，搜不到时用简化写法再试
  if (!html || !html.includes('class="result-item"')) {
    const simplified = title.replace(/['’:]/g, '').replace(/\s+/g, ' ').trim()
    if (simplified && simplified !== title) {
      html = await fetchSearch(simplified, 1)
    }
  }
  if (!html) return null

  const items = [
    ...html.matchAll(
      /<div class="result-item">[\s\S]*?href="https:\/\/www\.mcmod\.cn\/class\/\d+\.html"[^>]*>([\s\S]*?)<\/a>/g
    )
  ].map((m) => parseItem(m[1]))

  const target = normalize(title)
  // 1) 精确匹配英文名
  for (const it of items) {
    if (it.zh && it.en && normalize(it.en) === target) return it.zh
  }
  // 2) 英文名互相包含
  for (const it of items) {
    if (!it.zh || !it.en) continue
    const a = normalize(it.en)
    if (a.includes(target) || target.includes(a)) return it.zh
  }
  return null
}

/** 取一个标题的中文名：本地词典 → 缓存 → MC百科 */
export async function resolveZh(slug: string, title: string): Promise<string | null> {
  const dict = zhNameFor(slug, title)
  if (dict) return dict
  const c = loadCache()
  const key = title.toLowerCase().trim()
  if (c[key]) return c[key] || null
  if (inflight.has(key)) return inflight.get(key)!

  const p = (async () => {
    try {
      let zh = await searchMcmod(title)
      if (!zh) {
        await new Promise((r) => setTimeout(r, 400))
        zh = await searchMcmod(title)
      }
      // 只缓存查到的结果；没查到不缓存，下次还能重试
      if (zh) {
        c[key] = zh
        saveCacheSoon()
      }
      return zh
    } catch {
      return null
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

/** 批量解析：并发 3，已缓存的直接返回 */
export async function resolveZhBatch(
  items: { slug: string; title: string }[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const queue = [...items]
  const workers = Array.from({ length: 2 }, async () => {
    while (queue.length) {
      const it = queue.shift()
      if (!it) break
      const zh = await resolveZh(it.slug, it.title)
      if (zh) out[it.title] = zh
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * 中文 → 英文查询词反查。
 * 先查内置社区译名表（精准），再扫 mcmod 缓存里的「英文 → 中文」做包含匹配。
 * 返回候选英文词，按长度短的优先（更可能是正式名称）。
 */
export function resolveEnglishQueries(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out = new Set<string>()

  // 1. 内置表：slug 或中文名命中
  for (const [slug, zh] of Object.entries(ZH_NAMES)) {
    if (zh.toLowerCase().includes(q) || q.includes(zh.toLowerCase())) {
      // slug 通常就是英文名（如 sodium / create）
      out.add(slug)
    }
  }

  // 2. 缓存表：英文标题 → 中文名
  const c = loadCache()
  for (const [en, zh] of Object.entries(c)) {
    if (!zh) continue
    if (zh.toLowerCase().includes(q) || q.includes(zh.toLowerCase())) out.add(en)
  }

  // 3. 常见「中文游戏术语 → 英文关键词」兜底（覆盖内置表没有的情况）
  const TERMS: [RegExp, string][] = [
    [/机械动力/, 'create'],
    [/钠|渲染优化/, 'sodium'],
    [/铷/, 'rubidium'],
    [/嵌入|embeddium/, 'embeddium'],
    [/光影/, 'shader'],
    [/连接纹理|连通材质/, 'connected'],
    [/小地图/, 'minimap|xaero|journeymap'],
    [/物品栏|背包整理/, 'inventory|sorting'],
    [/合成表|配方查看|nei|jei/, 'jei|recipe'],
    [/护甲|装备/, 'armor'],
    [/武器/, 'weapon'],
    [/家具/, 'furniture'],
    [/农夫|农业/, 'farmer|agriculture'],
    [/水力|风力|发电/, 'energy|power'],
    [/储物|存储|箱子/, 'storage|refined'],
    [/传送|传点/, 'waystone|teleport'],
    [/地图/, 'map'],
    [/生物|怪物/, 'mob|creature'],
    [/声音|音效/, 'sound'],
    [/界面|UI/, 'ui|hud'],
    [/汉化/, 'chinese|translation'],
    [/互通|跨版本/, 'compat']
  ]
  for (const [re, en] of TERMS) {
    if (re.test(q)) for (const part of en.split('|')) out.add(part)
  }

  const list = [...out].filter(Boolean)
  // 短的优先（更接近真实项目名），限制 4 个避免请求过多
  return list.sort((a, b) => a.length - b.length).slice(0, 4)
}

export function zhCacheSize(): number {
  return Object.keys(loadCache()).length
}
