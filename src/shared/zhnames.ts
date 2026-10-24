/**
 * 常见模组 / 光影 / 资源包的中文名（社区通用译名）。
 * key 用 Modrinth 的 slug（小写）；也支持按英文标题兜底匹配。
 * 翻译只收录人工确认的译名，不做机翻，避免出现「钠」这种尬译。
 */
export const ZH_NAMES: Record<string, string> = {
  // —— 性能 / 优化 ——
  sodium: '钠·渲染优化',
  'sodium-extra': '钠·扩展',
  'reeses-sodium-options': 'Sodium 选项增强',
  lithium: '锂·服务端优化',
  iris: '虹彩·光影加载器',
  oculus: 'Oculus 光影',
  rubidium: '铷·渲染优化',
  embeddium: 'Embeddium 渲染优化',
  'ferrite-core': '铁氧体核心·内存优化',
  starlight: '星光·光照优化',
  phosphorus: '磷·区块优化',
  krypton: '氪·网络优化',
  lazydfu: 'LazyDFU 启动优化',
  memoryleakfix: '内存泄漏修复',
  modernfix: '现代修复',
  entityculling: '实体剔除',
  indium: '铟·渲染兼容',
  continuity: '连续性·连接材质',
  'lambdynamiclights': '兰布动态光源',
  effective: '有效·粒子特效',
  'falling-leaves': '落叶效果',
  'betterf3': 'F3 信息增强',
  zoomify: '缩放·镜头',
  'ok-zoomer': 'OK 缩放',
  'dynamic-fps': '动态帧率',
  cullleaves: '树叶剔除',
  'badoptimizations': '劣化修复',
  'immediatelyfast': '立即加速·渲染',
  'threadtweak': '线程优化',
  'noisium': 'Noisium 区块优化',

  // —— 基础库 / 前置 ——
  'fabric-api': 'Fabric API 前置',
  'cloth-config': 'Cloth 配置库',
  modmenu: '模组菜单',
  architectury: 'Architectury 跨平台前置',
  'architectury-api': 'Architectury 跨平台前置',
  'fabric-language-kotlin': 'Fabric Kotlin 前置',
  geckolib: 'GeckoLib 动画前置',
  'owo-lib': 'oωo 前置库',
  patchouli: '帕秋莉手册',
  balm: 'Balm 前置库',
  'bookshelf-lib': '书架前置库',
  'collective-api': 'Collective 前置',
  'puzzles-lib': 'Puzzles 前置',
  'midnightlib': 'MidnightLib 前置',
  yacl: 'YACL 配置库',
  'forge-config-api-port': 'Forge 配置 API',
  'kotlin-for-forge': 'Forge Kotlin 前置',

  // —— 实用工具 ——
  jei: 'JEI 物品管理器',
  rei: 'REI 物品管理器',
  emi: 'EMI 物品管理器',
  'roughly-enough-items': 'REI 物品管理器',
  jade: 'Jade 方块信息',
  'wthit': 'WTHIT 方块信息',
  'appleskin': '苹果皮·饥饿信息',
  'mouse-tweaks': '鼠标调整',
  'controlling': '按键冲突提示',
  'modmenu-badges': '模组徽章',
  'mods-command': '模组命令',
  'better-advancements': '进度增强',
  'toasts': '提示气泡',
  'inventory-profiles-next': '背包配置',
  'shulkerboxtooltip': '潜影盒预览',
  'equipment-compare': '装备对比',
  'modular-tooltips': '模块化提示',
  'durability-viewer': '耐久显示',
  'preview': '预览·物品信息',
  'better-mount-hud': '坐骑 HUD 增强',
  'chat-heads': '聊天头像',
  'no-chat-reports': '关闭聊天举报',
  'simple-voice-chat': '简单语音',
  'xaeros-minimap': 'Xaero 小地图',
  'xaeros-world-map': 'Xaero 世界地图',
  journeymap: '旅行地图',
  'not-enough-animations': '动画增强',
  'eating-animation': '进食动画',
  'first-person-model': '第一人称模型',
  'shoulder-surfing-reloaded': '肩视角',
  'freecam': '自由视角',
  'axiom': 'Axiom 建筑工具',
  'worldedit': '世界编辑',
  'effortless-building': '轻松建造',
  'litematica': '投影·结构图',
  'minihud': 'MiniHUD 信息显示',
  'tweakeroo': 'Tweakeroo 微调',
  'item-scroller': '物品滚动',
  'inventory-sorter': '背包整理',
  'inventory-profiles': '背包配置',

  // —— 内容 / 玩法 ——
  create: '机械动力',
  'create-addition': '机械动力·附加',
  'createaddition': '机械动力·电力',
  'create-encased': '机械动力·封装',
  'create-steam-n-rails': '机械动力·蒸汽与轨道',
  'create-diesel-generators': '机械动力·柴油发电',
  ae2: '应用能源2',
  appliedenergistics2: '应用能源2',
  'ae2wtlib': 'AE2 无线终端',
  botania: '植物魔法',
  twilightforest: '暮色森林',
  'the-twilight-forest': '暮色森林',
  thermal: '热力系列',
  'thermal-foundation': '热力基础',
  mekanism: '通用机械',
  'immersive-engineering': '沉浸工程',
  'tinkers-construct': '匠魂',
  'farmers-delight': '农夫乐事',
  'cooking-for-blockheads': '烹饪乐事',
  quark: '夸克',
  supplementaries: '补充装饰',
  'supplementaries-squared': '补充装饰·扩展',
  comforts: '舒适·睡袋',
  corpse: '尸体·死亡背包',
  'waystones': '传送石碑',
  'sophisticated-backpacks': '精致背包',
  'toms-storage': 'Tom 的存储',
  'functional-storage': '功能存储',
  'storagedrawers': '存储抽屉',
  'refined-storage': '精致存储',
  'iron-chests': '铁箱子',
  'iron-furnaces': '铁熔炉',
  'curios': '饰品栏',
  'curios-api': '饰品栏前置',
  apotheosis: '神化',
  'epic-fight-mod': '史诗战斗',
  'better-combat': '战斗增强',
  'pmmo': 'PMMO 技能',
  'projecte': '等价交换',
  'immersive-aircraft': '沉浸式飞行器',
  'valkyrien-skies': '瓦尔基里天空',
  'kubejs': 'KubeJS 脚本',
  'ftb-quests': 'FTB 任务',
  'ftb-teams': 'FTB 队伍',
  'ftb-chunks': 'FTB 区块认领',
  'ftb-library': 'FTB 前置库',
  'pams-harvestcraft': '潘马斯农场',
  'croptopia': '作物大全',
  'aquaculture': '水产养殖',
  'alexs-mobs': 'Alex 的生物',
  'alexs-delight': 'Alex 的乐事',
  'ice-and-fire': '冰与火之歌',
  'terrablender': 'TerraBlender 群系前置',
  'betterend': '更好的末地',
  'betternether': '更好的地狱',
  'terralith': 'Terralith 地形',
  'dungeons-and-taverns': '地牢与酒馆',
  'yungs-better-dungeons': 'YUNG 更好的地牢',
  'structory': '结构生成',
  'tectonic': 'Tectonic 地形',

  // —— 光影 ——
  'complementary-reimagined': 'Complementary 重构',
  'complementary-unbound': 'Complementary 无界',
  'complementary-shaders': 'Complementary 光影',
  'bsl-shaders': 'BSL 光影',
  'photon-shader': 'Photon 光子光影',
  'solas-shader': 'Solas 光影',
  'bliss-shader': 'Bliss 光影',
  'makeup-ultra-fast-shaders': 'MakeUp 超快光影',
  'sildurs-vibrant-shaders': 'Sildur 鲜艳光影',
  'sildurs-enhanced-default': 'Sildur 增强原版',
  'rethinking-voxels': 'Rethinking Voxels 光影',
  'chocapic13-shaders': 'Chocapic13 光影',
  'euphoria-patches': 'Euphoria 光影',

  // —— 资源包 ——
  'faithful-32x': 'Faithful 32x 原版高清',
  'faithful-64x': 'Faithful 64x 原版高清',
  'stay-true': 'Stay True 原版风',
  'fresh-animations': 'Fresh 动画',
  'low-fire': '低火焰',
  'better-grass': '更好的草',
  'xali-s-original-dark': "Xali's 原版暗黑 UI",
  'xali-s-enchanted-books': "Xali's 附魔书",
  'motschen-s-better-leaves': '更好的树叶',
  'default-hd-faithful': 'Default HD 高清',

  // —— 整合包 ——
  'fabulously-optimized': '极致优化整合包',
  'adrenasodium': 'Adrenaline 优化整合包',
  'simply-optimized': '简易优化整合包',
  'better-mc-forge-bmc1': 'Better MC 整合包',
  'better-mc-bmc2': 'Better MC 整合包 2',
  'all-of-fabric': 'All of Fabric 整合包',
  'all-of-fabric-6': 'All of Fabric 6 整合包',
  'cobblemon': 'Cobblemon 宝可梦',
  'cobblemon-fabric': 'Cobblemon 宝可梦',
  'atm9': 'All the Mods 9 整合包',
  'vault-hunters': 'Vault Hunters 整合包',
  'dawn-craft': 'DawnCraft 整合包'
}

/** 英文标题兜底匹配（slug 没命中时按标题查） */
const BY_TITLE: Record<string, string> = Object.fromEntries(
  Object.entries(ZH_NAMES).map(([k, v]) => [k.replace(/-/g, ' '), v])
)

export function zhNameFor(slug: string, title: string): string | undefined {
  const s = (slug || '').toLowerCase()
  if (ZH_NAMES[s]) return ZH_NAMES[s]
  const t = (title || '').toLowerCase().trim()
  if (ZH_NAMES[t.replace(/\s+/g, '-')]) return ZH_NAMES[t.replace(/\s+/g, '-')]
  if (BY_TITLE[t]) return BY_TITLE[t]
  return undefined
}

/**
 * 实用/必需的模组白名单：排序时给额外权重，
 * 让「优化、前置、物品管理器」这类东西排在纯装饰前面。
 */
export const ESSENTIAL = new Set<string>([
  'fabric-api',
  'sodium',
  'lithium',
  'iris',
  'jei',
  'rei',
  'emi',
  'appleskin',
  'modmenu',
  'cloth-config',
  'jade',
  'betterf3',
  'krypton',
  'ferrite-core',
  'starlight',
  'entityculling',
  'indium',
  'continuity',
  'lambdynamiclights',
  'memoryleakfix',
  'modernfix',
  'immediatelyfast',
  'badoptimizations',
  'mouse-tweaks',
  'controlling',
  'xaeros-minimap',
  'journeymap',
  'not-enough-animations',
  'shulkerboxtooltip',
  'architectury',
  'geckolib',
  'curios',
  'patchouli',
  'balm',
  'create',
  'ae2',
  'botania',
  'twilightforest',
  'waystones',
  'sophisticated-backpacks',
  'farmers-delight',
  'quark',
  'supplementaries',
  'simple-voice-chat'
])

/** 分类权重：优化/实用/前置 > 其他 */
export function categoryBoost(categories: string[]): number {
  const c = new Set(categories.map((x) => x.toLowerCase()))
  let boost = 0
  if (c.has('optimization') || c.has('performance')) boost += 6
  if (c.has('utility')) boost += 5
  if (c.has('library')) boost += 3
  if (c.has('storage')) boost += 2
  if (c.has('technology')) boost += 2
  if (c.has('adventure') || c.has('decoration') || c.has('worldgen')) boost += 0
  return boost
}

/**
 * 综合排序分：
 * 下载量（对数）+ 关注数（对数）+ 必备组件加权 + 分类加权。
 * 数据都来自 Modrinth 官方 API 的 downloads / follows。
 */
export function popularityScore(
  slug: string,
  downloads: number,
  follows: number,
  categories: string[]
): number {
  const d = Math.log10(Math.max(1, downloads)) * 10
  const f = Math.log10(Math.max(1, follows)) * 6
  const essential = ESSENTIAL.has(slug.toLowerCase()) ? 9 : 0
  return d + f + essential + categoryBoost(categories)
}
