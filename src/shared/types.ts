export type LocaleCode =
  | 'zh-CN'
  | 'zh-HK'
  | 'zh-TW'
  | 'en-US'
  | 'en-GB'
  | 'ru-RU'
  | 'ja-JP'
  | 'fr-FR'
  | 'de-DE'
  | 'es-ES'
  | 'ko-KR'

export type RegionCode =
  | 'CN'
  | 'HK'
  | 'MO'
  | 'TW'
  | 'RU'
  | 'US'
  | 'GB'
  | 'FR'
  | 'DE'
  | 'JP'
  | 'KR'
  | 'ES'
  | 'OTHER'

export interface RegionInfo {
  code: RegionCode
  /** 显示名按 locale 存，key 是 LocaleCode */
  locale: LocaleCode
  isMainlandChina: boolean
}

export type LoginMode = 'offline'

export interface AccountInfo {
  id: string
  name: string
  uuid: string
  mode: LoginMode
  /** 头像版本戳：换头像后变，用来打破图片缓存 */
  avatarVer?: number
  /** 账号 access token（离线账号为空串） */
  accessToken?: string
  /** 预留字段：外部账号 ID */
  clubUserName?: string
  /** 预留字段：外部令牌 */
  clubEmail?: string
  /** 令牌过期时间戳（毫秒） */
  clubExpiresAt?: number
  avatar?: string
  createdAt: number
}

export type ComponentLoader = 'vanilla' | 'forge' | 'neoforge' | 'fabric' | 'quilt'

/** 一个 Minecraft 项目（实例） */
export interface GameProject {
  id: string
  name: string
  mcVersion: string
  /** 真正用于启动的版本 id（加载器版本会是 fabric-loader-x-y / 1.20.1-forge-x 等） */
  versionId?: string
  loader: ComponentLoader
  loaderVersion?: string
  createdAt: number
  lastPlayedAt?: number
  /** 上次启动耗时（毫秒，点击启动到进入主菜单） */
  lastBootMs?: number
  /** 历史最快启动耗时 */
  bestBootMs?: number
  /** 累计启动次数 */
  launchCount?: number
  /** 该项目目录名（相对 games/） */
  dir: string
  /** —— 实例级设置（PCL 的「版本设置」） —— */
  memoryMb?: number
  memoryMode?: 'global' | 'auto' | 'custom'
  javaPath?: string
  width?: number
  height?: number
  /** 额外 JVM 参数，空格分隔 */
  jvmArgs?: string
  /** 额外游戏参数 */
  gameArgs?: string
  /** 版本隔离：mods/saves 放在实例目录内 */
  isolated?: boolean
  /** 窗口标题 */
  windowTitle?: string
  /** 自动进入的服务器地址 */
  joinServer?: string
  /** 版本描述 */
  desc?: string
  /** 收藏夹 */
  favorite?: boolean
  /** 分类（自定义字符串） */
  category?: string
  /** 图标标识：auto 或 emoji/字母 */
  icon?: string
}

export type Material = 'dark' | 'warm' | 'glass'

export type BackgroundMode = 'default' | 'preset' | 'image'

export interface AppearanceSettings {
  /** 背景来源：默认 / 官方预设 / 用户图片 */
  backgroundMode: BackgroundMode
  /** 自定义背景图的绝对路径，空字符串 = 默认背景 */
  backgroundFile: string
  /** 背景压暗程度 0-80 */
  backgroundDim: number
  /** 材质：深黑 / 暖白 / 玻璃 */
  material: Material
  /** 主色（按钮、强调色） */
  accent: string
}

export interface AppSettings {
  locale: LocaleCode
  region: RegionCode
  /** 用户是否已经完成过地区选择（首次启动为 false） */
  regionChosen: boolean
  /** 中国大陆地区提示是否已确认 */
  regionNoticeAccepted: boolean
  
  /** 下载源：官方直连 / 镜像 */
  downloadSource: 'official' | 'mirror'
  
  /** 更新检查地址（空 = 不检查） */
  updateManifestUrl: string
  /** 是否显示 Forge/NeoForge 的早期加载窗口（关闭更稳，默认关闭） */
  forgeEarlyWindow: boolean
  /** CurseForge 下载代理（留空则不启用） */
  cfApiBase: string
  /** 自备 CurseForge API Key（可选，代理不可用时使用） */
  curseforgeApiKey: string
  /** 启动时自动检查更新（设置里可关） */
  autoCheckUpdate: boolean
  /** 更新渠道 */
  updateChannel: 'stable' | 'beta'
  /** 用户点过「不用了，谢谢」的版本号：同一版本不再提醒 */
  skippedVersion: string
  maxMemoryMb: number
  javaPath: string
  autoJava: boolean
  /** 额外扫描的游戏目录（PCL 的「文件夹列表」） */
  gameDirs: string[]
  /** 全局窗口标题（实例可覆盖） */
  windowTitle: string
  appearance: AppearanceSettings
}

export interface AppState {
  settings: AppSettings
  accounts: AccountInfo[]
  projects: GameProject[]
  activeAccountId?: string
  activeProjectId?: string
}
