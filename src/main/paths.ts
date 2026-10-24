import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs'
import { dirname, join } from 'path'

/**
 * 数据根目录规则：
 * · 开发环境 / 便携版（未安装）：%APPDATA%/RAINBOWMC
 * · NSIS 安装版：<安装目录>/data（安装时就建好，升级覆盖安装时不会被删）
 *
 * 若安装版第一次启动时发现 %APPDATA%/RAINBOWMC 里有旧数据、而 <安装目录>/data 是空的，
 * 会自动把旧数据迁移过来（存档、组件库、版本、账号、日志全带走）。
 */
export function installRoot(): string | null {
  if (!app.isPackaged) return null
  // 便携版（portable target）会解压到临时目录运行，真实位置在 PORTABLE_EXECUTABLE_DIR
  const portableDir = process.env['PORTABLE_EXECUTABLE_DIR']
  if (portableDir) return portableDir
  return dirname(app.getPath('exe'))
}

function legacyRoot(): string {
  return join(app.getPath('appData'), 'RAINBOWMC')
}

function installedDataRoot(): string | null {
  const root = installRoot()
  if (!root) return null
  return join(root, 'data')
}

export function dataRoot(): string {
  return installedDataRoot() ?? legacyRoot()
}

/**
 * 自愈：安装器万一在「备份 data → 还原」之间失败（进程被杀、磁盘满、文件被占用），
 * 会留下 <安装目录>-data-backup。这里在启动时把它恢复回来，保证存档 / 组件库 / 加载器不丢。
 *
 * · data 不存在或为空  → 直接整目录改名回来（瞬间完成）
 * · data 已有内容      → 逐项合并（备份优先，不覆盖已有新文件之外的旧文件）
 */
/** data 目录里是否有「真东西」（安装器只建空子目录，不能被当成已有数据） */
function hasRealData(dir: string): boolean {
  try {
    if (!existsSync(dir)) return false
    // 只看「真数据」：config.json 不能当依据 —— 安装器或首次启动都会生成它，
    // 否则新装后会把旧数据误判成「已经迁移过」而跳过迁移。
    for (const sub of ['games', 'libraries', 'versions', 'assets', 'runtime', 'logs']) {
      const p = join(dir, sub)
      if (existsSync(p) && readdirSync(p).length > 0) return true
    }
    return false
  } catch {
    return false
  }
}
export function recoverBackupIfNeeded(): { recovered: boolean; backupPath?: string; error?: string } {
  const root = installRoot()
  if (!root) return { recovered: false }
  const backup = `${root}-data-backup`
  if (!existsSync(backup)) return { recovered: false }
  const target = dataRoot()
  try {
    let empty = true
    try {
      empty = !existsSync(target) || readdirSync(target).length === 0
    } catch {
      empty = true
    }
    if (empty) {
      mkdirSync(dirname(target), { recursive: true })
      renameSync(backup, target)
      return { recovered: true, backupPath: backup }
    }
    // 两份都有内容 → 合并（保留目标已有文件，补齐备份里缺的）
    cpSync(backup, target, { recursive: true, force: false, errorOnExist: false })
    rmSync(backup, { recursive: true, force: true })
    return { recovered: true, backupPath: backup }
  } catch (e) {
    return { recovered: false, backupPath: backup, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 迁移旧 %APPDATA%/RAINBOWMC 数据；失败时返回 legacy 路径，交给界面提示用户 */
export function migrateLegacyData(): { migrated: boolean; failed?: boolean; legacyPath: string } {
  const target = installedDataRoot()
  const legacy = legacyRoot()
  if (!target) return { migrated: false, legacyPath: legacy }
  if (!existsSync(legacy)) return { migrated: false, legacyPath: legacy }
  if (hasRealData(target)) return { migrated: false, legacyPath: legacy }
  try {
    // 安装器只建了空子目录 → 删掉它，这样能用「改名」瞬间完成迁移（同盘时）
    if (existsSync(target) && !hasRealData(target)) rmSync(target, { recursive: true, force: true })
  } catch {
    /* 删不掉就走下面的复制 */
  }
  try {
    mkdirSync(dirname(target), { recursive: true })
    renameSync(legacy, target)
    return { migrated: true, legacyPath: legacy }
  } catch {
    // 跨盘改名失败 → 退化为递归复制，复制完再删旧目录；仍失败则保留旧目录并上报
    try {
      cpSync(legacy, target, { recursive: true, force: false })
      rmSync(legacy, { recursive: true, force: true })
      return { migrated: true, legacyPath: legacy }
    } catch {
      return { migrated: false, failed: true, legacyPath: legacy }
    }
  }
}

export const paths = {
  root: () => dataRoot(),
  config: () => join(dataRoot(), 'config.json'),
  games: () => join(dataRoot(), 'games'),
  logs: () => join(dataRoot(), 'logs'),
  cache: () => join(dataRoot(), 'cache'),
  assets: () => join(dataRoot(), 'assets'),
  libraries: () => join(dataRoot(), 'libraries'),
  versions: () => join(dataRoot(), 'versions'),
  runtime: () => join(dataRoot(), 'runtime'),
  backgrounds: () => join(dataRoot(), 'backgrounds')
}

export function ensureDirs(): void {
  for (const dir of [
    dataRoot(),
    paths.games(),
    paths.logs(),
    paths.cache(),
    paths.assets(),
    paths.libraries(),
    paths.versions(),
    paths.runtime(),
    paths.backgrounds()
  ]) {
    mkdirSync(dir, { recursive: true })
  }
}
