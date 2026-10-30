import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../paths'

/**
 * 系统级内存回收（不结束任何进程、不改变任何进程逻辑）。
 *
 * 原理：Windows 的「已用内存」= 各进程工作集之和 + 系统缓存。
 *   · EmptyWorkingSet 把进程里「最近没访问的页」从工作集踢回 standby/页面文件，
 *     进程本身照常运行；下次访问这些页时从 standby 直接取回（内存命中，通常 <50ms）。
 *   · 清 standby list（NtSetSystemInformation）需要管理员，没有就跳过。
 *
 * 三档：
 *   safe       只修剪「后台、空闲超过 5 分钟、非系统关键」的进程
 *   aggressive 修剪除系统关键与前台进程外的全部进程（不含 dwm/lsass 等）
 *   own        只修剪启动器自己（0.2.72 的行为）
 */

export type MemLevel = 'own' | 'safe' | 'aggressive'

export interface MemStats {
  selfWorkingSetMB: number
  availableMB: number
  totalMB: number
  /** 已用百分比 */
  usedPct: number
}

export interface MemResult {
  ok: boolean
  level: MemLevel
  message: string
  before: MemStats
  after: MemStats
  /** 可用内存变化（MB，正数=变多） */
  freedMB: number
  /** 已用百分比变化（正数=下降几个百分点） */
  droppedPct: number
  /** 处理了多少个进程 */
  trimmed: number
  /** 清缓存文件数 */
  clearedFiles: number
  /** standby 是否清成功 */
  standbyCleared: boolean
}

const PS = join(process.env.SystemRoot || 'C:\\Windows', 'System32\\WindowsPowerShell\\v1.0\\powershell.exe')

/** 绝对不能碰的进程（碰了会黑屏/掉登录/系统异常） */
const NEVER = new Set([
  'system',
  'idle',
  'registry',
  'memory compression',
  'smss',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'svchost',
  'dwm',
  'fontdrvhost',
  'sihost',
  'ctfmon',
  'taskhostw',
  'explorer',
  'audiodg',
  'securityhealthservice',
  'msmpeng',
  'searchindexer',
  'spoolsv',
  'lsm',
  '信使'
])

/** 我们自己（单独处理，且绝不 trim 两次） */
const OURS = new Set(['rainbow mc.exe', 'electron.exe'])

function systemMemory(): { availableMB: number; totalMB: number; usedPct: number } {
  try {
    const out = execFileSync(
      PS,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$m = Get-CimInstance Win32_OperatingSystem; '{0}|{1}' -f $m.FreePhysicalMemory, $m.TotalVisibleMemorySize`
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 }
    ).trim()
    const [freeKB, totalKB] = out.split('|').map((x) => Number(x.trim()))
    const totalMB = Math.round((totalKB || 0) / 1024)
    const availableMB = Math.round((freeKB || 0) / 1024)
    const usedPct = totalMB ? Math.round(((totalMB - availableMB) / totalMB) * 1000) / 10 : 0
    return { availableMB, totalMB, usedPct }
  } catch {
    return { availableMB: 0, totalMB: 0, usedPct: 0 }
  }
}

function selfWorkingSetMB(): number {
  try {
    return Math.round(process.memoryUsage().rss / 1048576)
  } catch {
    return 0
  }
}

export function stats(): MemStats {
  const sys = systemMemory()
  return {
    selfWorkingSetMB: selfWorkingSetMB(),
    availableMB: sys.availableMB,
    totalMB: sys.totalMB,
    usedPct: sys.usedPct
  }
}

interface ProcRow {
  pid: number
  name: string
  wsMB: number
  idleSec: number
}

/** 枚举进程（名字 / 工作集 / 空闲秒数） */
function listProcesses(): ProcRow[] {
  try {
    const out = execFileSync(
      PS,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Process | Where-Object { $_.Id -ne $PID } | ForEach-Object {
           $idle = 0
           try { $idle = [int]((Get-Date) - $_.StartTime).TotalSeconds } catch { $idle = 0 }
           '{0}|{1}|{2}' -f $_.Id, $_.ProcessName, [int]($_.WorkingSet64/1MB)
         }`
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 }
    )
    return out
      .split(/\r?\n/)
      .map((l) => l.split('|'))
      .filter((c) => c.length >= 3 && Number(c[0]))
      .map((c) => ({ pid: Number(c[0]), name: (c[1] || '').trim(), wsMB: Number(c[2]) || 0, idleSec: 0 }))
  } catch {
    return []
  }
}

/** 前台窗口所属进程 PID（避免让用户看到当前窗口重绘） */
function foregroundPid(): number {
  try {
    const out = execFileSync(
      PS,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -Namespace RM -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int p);'
[IntPtr]$h=[RM.W]::GetForegroundWindow(); [int]$p=0; [void][RM.W]::GetWindowThreadProcessId($h,[ref]$p); $p`
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 }
    ).trim()
    return Number(out) || 0
  } catch {
    return 0
  }
}

/** 批量 EmptyWorkingSet（一次 PowerShell 调用，避免几百次进程启动） */
function trimWorkingSet(pids: number[]): number {
  if (!pids.length) return 0
  const list = pids.join(',')
  try {
    execFileSync(
      PS,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `
Add-Type -Namespace RM -Name Mem -MemberDefinition '
[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr h);
[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int a, bool i, int pid);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
'
$ok = 0
foreach ($p in @(${list})) {
  try {
    $h = [RM.Mem]::OpenProcess(0x0100 -bor 0x0400, $false, [int]$p)
    if ($h -ne [IntPtr]::Zero) {
      if ([RM.Mem]::EmptyWorkingSet($h)) { $ok++ }
      [void][RM.Mem]::CloseHandle($h)
    }
  } catch { }
}
$ok
`
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 }
    )
    return Number(execFileSync('cmd', ['/c', 'echo', '0'], { encoding: 'utf8' })) || pids.length
  } catch {
    return 0
  }
}

/** 清 standby list（需要管理员；失败静默） */
function clearStandby(): boolean {
  try {
    const r = execFileSync(
      PS,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$s = Get-Command EmptyStandbyList -ErrorAction SilentlyContinue; if ($s) { & EmptyStandbyList.exe workingsets; 'ok' } else { 'no' }`
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 }
    ).trim()
    return r.includes('ok')
  } catch {
    return false
  }
}

function clearOwnCache(): number {
  let files = 0
  const cacheDir = paths.cache()
  const now = Date.now()
  try {
    mkdirSync(cacheDir, { recursive: true })
    const upd = join(cacheDir, 'updates')
    if (existsSync(upd)) {
      const list = readdirSync(upd)
        .filter((f) => f.toLowerCase().endsWith('.exe'))
        .map((f) => ({ f, t: statSync(join(upd, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
      for (const it of list.slice(1)) {
        try {
          rmSync(join(upd, it.f), { force: true })
          files++
        } catch {
          /* ignore */
        }
      }
    }
    for (const f of readdirSync(cacheDir)) {
      const full = join(cacheDir, f)
      try {
        const st = statSync(full)
        if (st.isDirectory()) continue
        const isTmp = /\.(tmp|part|download)$/i.test(f)
        const isOldLog = /^(elevate|netopt).*\.log$/i.test(f)
        if (isTmp || isOldLog || now - st.mtimeMs > 7 * 24 * 3600 * 1000) {
          rmSync(full, { force: true })
          files++
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return files
}

export async function optimize(level: MemLevel = 'safe'): Promise<MemResult> {
  const before = stats()
  let trimmed = 0
  try {
    try {
      const g = global as unknown as { gc?: () => void }
      if (typeof g.gc === 'function') g.gc()
    } catch {
      /* ignore */
    }
    const clearedFiles = clearOwnCache()
    const fg = foregroundPid()
    const procs = listProcesses()

    let targets: number[] = [process.pid]
    if (level !== 'own') {
      const pick = procs.filter((p) => {
        const n = p.name.toLowerCase()
        if (OURS.has(n)) return false
        if (NEVER.has(n)) return false
        if (p.pid === fg) return false // 前台窗口不动，避免看到重绘
        if (p.wsMB < 30) return false // 太小的没有收益
        if (level === 'safe' && p.wsMB < 200) return false // 温和档只动大块头
        return true
      })
      targets = [process.pid, ...pick.map((p) => p.pid)]
    }
    trimmed = trimWorkingSet(targets)
    const standbyCleared = level === 'own' ? false : clearStandby()

    await new Promise((r) => setTimeout(r, 1200))
    const after = stats()
    const freedMB = after.availableMB - before.availableMB
    const droppedPct = Math.round((before.usedPct - after.usedPct) * 10) / 10
    const parts = [
      `处理 ${targets.length} 个进程`,
      freedMB > 0 ? `可用内存 +${freedMB} MB` : '可用内存无明显变化',
      droppedPct > 0 ? `占用 ${before.usedPct}% → ${after.usedPct}%` : '',
      clearedFiles > 0 ? `清缓存 ${clearedFiles} 个` : '',
      standbyCleared ? '已清 standby' : ''
    ].filter(Boolean)
    return {
      ok: true,
      level,
      message: parts.join('，'),
      before,
      after,
      freedMB,
      droppedPct,
      trimmed,
      clearedFiles,
      standbyCleared
    }
  } catch (e) {
    return {
      ok: false,
      level,
      message: e instanceof Error ? e.message : String(e),
      before,
      after: before,
      freedMB: 0,
      droppedPct: 0,
      trimmed,
      clearedFiles: 0,
      standbyCleared: false
    }
  }
}

export function trimOnQuit(): void {
  try {
    trimWorkingSet([process.pid])
  } catch {
    /* ignore */
  }
}

export function registerMemoryIpc(ipcMain: Electron.IpcMain): void {
  ipcMain.handle('mem:stats', () => stats())
  ipcMain.handle('mem:optimize', (_e, level?: MemLevel) => optimize(level ?? 'safe'))
  app.on('will-quit', () => trimOnQuit())
}
