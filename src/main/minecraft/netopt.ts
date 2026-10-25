import { execFileSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import { paths } from '../paths'

/**
 * 联机加速：全部是「本机网络栈」层面的优化，不需要任何服务器。
 *
 * 四件事（都能撤销）：
 *   1. 给陶瓦开防火墙放行（UDP 入站最关键——Windows 默认会挡，直接导致打洞失败）
 *   2. 关闭 Windows 网络节流（NetworkThrottlingIndex），高负载时丢包更少
 *   3. IPv6 优先（改前缀策略，让连接优先走 IPv6，绕开对称型 NAT）
 *   4. 跳过测速不通的公共节点（用 hosts 把死节点指到 127.0.0.1，让陶瓦快速换节点）
 *
 * 1~3 需要管理员权限（会弹一次 UAC），4 需要写 hosts（也需要管理员）。
 */

export type OptId = 'firewall' | 'throttle' | 'ipv6' | 'hosts'

export interface OptState {
  id: OptId
  name: string
  desc: string
  /** 当前是否已生效 */
  applied: boolean
  /** 需要管理员 */
  admin: boolean
  /** 无法判断时给出说明 */
  note?: string
}

export interface OptResult {
  ok: boolean
  applied: OptId[]
  failed: { id: OptId; error: string }[]
  needsAdmin: boolean
  log: string[]
}

const TC_GLOB = 'terracotta'
const HOSTS = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers\\etc\\hosts')
const HOSTS_MARK = '# RAINBOWMC-MP-OPT'
const DEAD_NODES = ['public.easytier.top', 'public2.easytier.cn']

/** 标记文件：记录我们改过哪些项（netsh 输出本地化不稳定，用标记更可靠） */
const MARK_FILE = (): string => join(paths.root(), 'cache', 'netopt.json')
function readMarks(): Record<string, boolean> {
  try {
    return JSON.parse(readFileSync(MARK_FILE(), 'utf8')) as Record<string, boolean>
  } catch {
    return {}
  }
}
function writeMark(id: string, on: boolean): void {
  const m = readMarks()
  if (on) m[id] = true
  else delete m[id]
  try {
    const { mkdirSync } = require('fs') as typeof import('fs')
    mkdirSync(join(paths.root(), 'cache'), { recursive: true })
    writeFileSync(MARK_FILE(), JSON.stringify(m), 'utf8')
  } catch {
    /* ignore */
  }
}

function run(cmd: string, args: string[], timeout = 8000): { ok: boolean; out: string } {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true })
    return { ok: true, out }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, out: (err.stdout || '') + (err.stderr || '') || err.message || '' }
  }
}

function ps(script: string, timeout = 15000): { ok: boolean; out: string } {
  return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], timeout)
}


/** 当前进程是否已提权（管理员） */
export function isElevated(): boolean {
  const r = run('net', ['session'])
  return r.ok
}

/** 以管理员身份重启启动器（只弹一次 UAC，之后所有优化都不再弹） */
const PS_EXE = join(process.env.SystemRoot || 'C:\\Windows', 'System32\\WindowsPowerShell\\v1.0\\powershell.exe')

/** UAC 弹窗进程是否出现（出现说明请求到达了 Windows，是否点是用户的事） */
function consentVisible(): boolean {
  const r = run('tasklist', ['/FI', 'IMAGENAME eq consent.exe', '/NH'], 4000)
  return /consent\.exe/i.test(r.out)
}

export interface ElevateResult {
  ok: boolean
  /** 是否真的弹出了系统授权窗口 */
  uacShown: boolean
  /** 管理员实例是否已经启动 */
  adminStarted: boolean
  /** 被系统策略拦截（没有弹窗，请求没到达用户） */
  blocked?: boolean
  message?: string
}

export async function relaunchElevated(): Promise<ElevateResult> {
  const fs = require('fs') as typeof import('fs')
  const dir = join(paths.root(), 'cache')
  const logFile = join(dir, 'elevate.log')
  const marker = join(dir, 'admin-started.json')
  const psLog = join(dir, 'elevate-ps.log')
  const dbg = (msg: string): void => {
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\r\n`, 'utf8')
    } catch {
      /* ignore */
    }
  }
  const exists = (p: string): boolean => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  }

  try {
    fs.mkdirSync(dir, { recursive: true })
    try {
      fs.writeFileSync(logFile, '', 'utf8')
      if (exists(psLog)) fs.unlinkSync(psLog)
    } catch {
      /* ignore */
    }
    if (exists(marker)) {
      try {
        fs.unlinkSync(marker)
      } catch {
        /* ignore */
      }
    }

    // 测试用：强制模拟「被拦截」分支
    if (process.env['RAINBOW_SIMULATE_NO_UAC'] === '1') {
      dbg('SIMULATE no-uac')
      return { ok: false, uacShown: false, adminStarted: false, blocked: true, message: '模拟：被拦截' }
    }

    const exe = process.execPath
    const cmdFile = join(dir, 'elevate.cmd')
    fs.writeFileSync(cmdFile, `@echo off\r\nstart "" "${exe}" --admin\r\n`, 'utf8')
    const ps1 = join(dir, 'elevate.ps1')
    fs.writeFileSync(
      ps1,
      `$ErrorActionPreference='Stop'\r\ntry {\r\n  Start-Process -FilePath '${cmdFile}' -Verb RunAs\r\n  'OK' | Out-File -FilePath '${psLog}' -Encoding utf8\r\n} catch {\r\n  $_.Exception.Message | Out-File -FilePath '${psLog}' -Encoding utf8\r\n}\r\n`,
      'utf8'
    )
    dbg('exe=' + exe)

    const { spawn } = require('child_process') as typeof import('child_process')
    const child = spawn(PS_EXE, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.on('error', (e: Error) => dbg('spawn error=' + e.message))
    child.unref()
    dbg('spawned pid=' + String(child.pid ?? '?'))

    // 1) 2.5 秒内看有没有出现 UAC 弹窗
    let uacShown = false
    const tUac = Date.now()
    while (Date.now() - tUac < 2500) {
      await new Promise((r2) => setTimeout(r2, 250))
      if (consentVisible()) {
        uacShown = true
        dbg('consent.exe 已出现 → UAC 弹窗已显示')
        break
      }
      if (exists(marker)) {
        dbg('管理员实例已启动（可能 UAC 被设为不再提示）')
        return { ok: true, uacShown: false, adminStarted: true, message: '管理员实例已启动' }
      }
    }

    // 2) 弹窗出现了：等用户点击（最多 20 秒）看管理员实例是否起来
    if (uacShown) {
      const t2 = Date.now()
      while (Date.now() - t2 < 20000) {
        if (exists(marker)) {
          let pid = 0
          try {
            pid = (JSON.parse(fs.readFileSync(marker, 'utf8')) as { pid?: number }).pid ?? 0
          } catch {
            /* ignore */
          }
          return {
            ok: true,
            uacShown: true,
            adminStarted: true,
            message: `管理员实例已启动（PID ${pid || '?'}），请关掉当前窗口`
          }
        }
        await new Promise((r2) => setTimeout(r2, 300))
      }
      let detail = ''
      try {
        if (exists(psLog)) detail = fs.readFileSync(psLog, 'utf8').trim()
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        uacShown: true,
        adminStarted: false,
        message: detail
          ? `授权未完成：${detail.slice(0, 120)}`
          : '已弹出系统授权窗口，但没有等到管理员实例（可能是点了「否」或窗口被关掉了）'
      }
    }

    // 3) 既没弹窗也没启动 → 被系统策略/安全软件拦截
    let detail = ''
    try {
      if (exists(psLog)) detail = fs.readFileSync(psLog, 'utf8').trim()
    } catch {
      /* ignore */
    }
    dbg('no consent, no marker → blocked. psLog=' + detail.slice(0, 120))
    return {
      ok: false,
      uacShown: false,
      adminStarted: false,
      blocked: true,
      message: detail || '该申请已被 Windows 拦截（没有弹出授权窗口）'
    }
  } catch (e) {
    dbg('EXCEPTION ' + (e instanceof Error ? e.message : String(e)))
    return { ok: false, uacShown: false, adminStarted: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** 直接执行（仅在已提权时调用），返回失败项 */
function runLines(lines: string[]): { failed: string[]; log: string[] } {
  const failed: string[] = []
  const log: string[] = []
  for (const ln of lines) {
    const r = ps(ln, 20000)
    log.push(`${r.ok ? 'OK ' : 'ERR'} ${ln.slice(0, 80)}`)
    if (!r.ok) failed.push(ln)
  }
  return { failed, log }
}

/* ─────────── 检测 ─────────── */

export function detect(): OptState[] {
  const out: OptState[] = []

  // 1. 防火墙：看有没有我们加的两条规则
  const fw = run('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=RAINBOWMC-Terracotta-UDP'])
  out.push({
    id: 'firewall',
    name: '陶瓦防火墙放行（UDP 入站）',
    desc: 'Windows 默认拦截入站 UDP，会让打洞成功率大幅下降。放行后直连概率明显提高。',
    applied: fw.ok && /RAINBOWMC-Terracotta-UDP/.test(fw.out),
    admin: true
  })

  // 2. 网络节流
  const reg = ps(
    `(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile' -Name NetworkThrottlingIndex -ErrorAction SilentlyContinue).NetworkThrottlingIndex`
  )
  const val = reg.out.trim()
  out.push({
    id: 'throttle',
    name: '关闭网络节流',
    desc: 'Windows 默认每毫秒最多处理 10 个网络包，高负载时会造成丢包与延迟抖动。关闭后联机更稳。',
    applied: val === '4294967295' || val === '0xffffffff',
    admin: true,
    note: val ? `当前值 ${val}` : '未设置（默认 10）'
  })

  // 3. IPv6 优先（用我们自己的标记判断，避免 netsh 本地化差异）
  const marks = readMarks()
  out.push({
    id: 'ipv6',
    name: 'IPv6 优先',
    desc: '把 IPv6 的前缀优先级提到 IPv4 之上，绕开对称型 NAT（这条路不需要打洞）。',
    applied: !!marks['ipv6'],
    admin: true,
    note: marks['ipv6'] ? '已提升 IPv6 前缀优先级' : '当前为 Windows 默认顺序'
  })

  // 4. hosts 跳过死节点
  let hostsTxt = ''
  try {
    hostsTxt = readFileSync(HOSTS, 'utf8')
  } catch {
    /* ignore */
  }
  out.push({
    id: 'hosts',
    name: '跳过不通的公共节点',
    desc: '把连不上的 EasyTier 公共节点指到 127.0.0.1，让陶瓦立刻换到能用的节点，少等 10~20 秒。',
    applied: hostsTxt.includes(HOSTS_MARK),
    admin: true
  })

  return out
}

/* ─────────── 应用 / 撤销 ─────────── */

function elevatedScript(lines: string[]): OptResult {
  const tmp = join(process.env.TEMP || 'C:\\Windows\\Temp', `rm-mpopt-${Date.now()}.ps1`)
  const body =
    '$ErrorActionPreference = "Continue"\r\n' +
    lines.join('\r\n') +
    '\r\n"__DONE__" | Out-File -FilePath "' +
    tmp +
    '.done" -Encoding utf8\r\n'
  writeFileSync(tmp, body, 'utf8')
  const r = ps(
    `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${tmp}'`,
    120000
  )
  const doneFile = tmp + '.done'
  const done = existsSync(doneFile)
  return {
    ok: done || r.ok,
    applied: [],
    failed: [],
    needsAdmin: !done,
    log: [r.out].filter(Boolean)
  }
}

export function apply(ids: OptId[], tcExe?: string): OptResult {
  const lines: string[] = []
  if (ids.includes('firewall')) {
    const exe = tcExe || ''
    lines.push(
      `netsh advfirewall firewall delete rule name='RAINBOWMC-Terracotta-UDP'`,
      `netsh advfirewall firewall delete rule name='RAINBOWMC-Terracotta-TCP'`,
      exe
        ? `netsh advfirewall firewall add rule name='RAINBOWMC-Terracotta-UDP' dir=in action=allow protocol=UDP program='${exe}'`
        : `netsh advfirewall firewall add rule name='RAINBOWMC-Terracotta-UDP' dir=in action=allow protocol=UDP`,
      exe
        ? `netsh advfirewall firewall add rule name='RAINBOWMC-Terracotta-TCP' dir=in action=allow protocol=TCP program='${exe}'`
        : `netsh advfirewall firewall add rule name='RAINBOWMC-Terracotta-TCP' dir=in action=allow protocol=TCP`
    )
  }
  if (ids.includes('throttle')) {
    lines.push(
      `reg add 'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile' /v NetworkThrottlingIndex /t REG_DWORD /d 4294967295 /f`
    )
  }
  if (ids.includes('ipv6')) {
    lines.push(
      `netsh interface ipv6 set prefixpolicy ::/0 60 1`,
      `netsh interface ipv6 set prefixpolicy ::ffff:0:0/96 35 4`
    )
  }
  if (ids.includes('hosts')) {
    const bak = HOSTS + '.rainbowmc.bak'
    lines.push(
      `if (-not (Test-Path '${bak}')) { Copy-Item '${HOSTS}' '${bak}' -Force }`,
      `$h = Get-Content '${HOSTS}' -Raw`,
      `if ($h -notmatch 'RAINBOWMC-MP-OPT') { $l = @('${HOSTS_MARK}') + (${JSON.stringify(DEAD_NODES)} | ForEach-Object { '127.0.0.1 ' + $_ }); Add-Content '${HOSTS}' -Value $l }`,
      `ipconfig /flushdns`
    )
  }
  if (!lines.length) return { ok: true, applied: [], failed: [], needsAdmin: false, log: [] }

  if (!isElevated()) {
    return {
      ok: false,
      applied: [],
      failed: [],
      needsAdmin: true,
      log: ['当前不是管理员，网络优化需要管理员权限。请点「以管理员身份重启启动器」。']
    }
  }

  const r = runLines(lines)
  for (const id of ids) if (!r.failed.length) writeMark(id, true)
  const st = detect()
  return {
    ok: r.failed.length === 0,
    applied: ids.filter((id) => st.find((x) => x.id === id)?.applied),
    failed: ids.filter((id) => r.failed.length > 0).map((id) => ({ id, error: '命令执行失败' })),
    needsAdmin: false,
    log: r.log
  }
}

export function revert(ids: OptId[]): OptResult {
  const lines: string[] = []
  if (ids.includes('firewall')) {
    lines.push(
      `netsh advfirewall firewall delete rule name='RAINBOWMC-Terracotta-UDP'`,
      `netsh advfirewall firewall delete rule name='RAINBOWMC-Terracotta-TCP'`
    )
  }
  if (ids.includes('throttle')) {
    lines.push(
      `reg add 'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile' /v NetworkThrottlingIndex /t REG_DWORD /d 10 /f`
    )
  }
  if (ids.includes('ipv6')) {
    lines.push(`netsh interface ipv6 set prefixpolicy ::/0 40 1`, `netsh interface ipv6 set prefixpolicy ::ffff:0:0/96 35 4`)
  }
  if (ids.includes('hosts')) {
    const bak = HOSTS + '.rainbowmc.bak'
    lines.push(
      `if (Test-Path '${bak}') { Copy-Item '${bak}' '${HOSTS}' -Force } else { (Get-Content '${HOSTS}') | Where-Object { $_ -notmatch 'RAINBOWMC-MP-OPT' -and $_ -notmatch '127.0.0.1 public' } | Set-Content '${HOSTS}' }`,
      `ipconfig /flushdns`
    )
  }
  if (!lines.length) return { ok: true, applied: [], failed: [], needsAdmin: false, log: [] }
  if (!isElevated()) {
    return { ok: false, applied: [], failed: [], needsAdmin: true, log: ['需要管理员权限'] }
  }
  const r = runLines(lines)
  for (const id of ids) writeMark(id, false)
  const st = detect()
  return {
    ok: r.failed.length === 0,
    applied: ids.filter((id) => st.find((x) => x.id === id)?.applied),
    failed: [],
    needsAdmin: false,
    log: r.log
  }
}

/* ─────────── 一键优化脚本（绕过 UAC 自动提权，右键以管理员运行即可） ─────────── */

const OPT_CMDS: Record<OptId, string[]> = {
  firewall: [
    'netsh advfirewall firewall delete rule name="RAINBOWMC-Terracotta-UDP" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="RAINBOWMC-Terracotta-TCP" >nul 2>&1',
    'netsh advfirewall firewall add rule name="RAINBOWMC-Terracotta-UDP" dir=in action=allow protocol=UDP',
    'netsh advfirewall firewall add rule name="RAINBOWMC-Terracotta-TCP" dir=in action=allow protocol=TCP'
  ],
  throttle: [
    'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v NetworkThrottlingIndex /t REG_DWORD /d 4294967295 /f'
  ],
  ipv6: ['netsh interface ipv6 set prefixpolicy ::/0 60 1', 'netsh interface ipv6 set prefixpolicy ::ffff:0:0/96 35 4'],
  hosts: [
    'copy "%SystemRoot%\\System32\\drivers\\etc\\hosts" "%SystemRoot%\\System32\\drivers\\etc\\hosts.rainbowmc.bak" /Y >nul 2>&1',
    'echo # RAINBOWMC-MP-OPT>>"%SystemRoot%\\System32\\drivers\\etc\\hosts"',
    'echo 127.0.0.1 public.easytier.top>>"%SystemRoot%\\System32\\drivers\\etc\\hosts"',
    'echo 127.0.0.1 public2.easytier.cn>>"%SystemRoot%\\System32\\drivers\\etc\\hosts"',
    'ipconfig /flushdns >nul'
  ]
}

const REVERT_CMDS: Record<OptId, string[]> = {
  firewall: [
    'netsh advfirewall firewall delete rule name="RAINBOWMC-Terracotta-UDP"',
    'netsh advfirewall firewall delete rule name="RAINBOWMC-Terracotta-TCP"'
  ],
  throttle: [
    'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v NetworkThrottlingIndex /t REG_DWORD /d 10 /f'
  ],
  ipv6: ['netsh interface ipv6 set prefixpolicy ::/0 40 1', 'netsh interface ipv6 set prefixpolicy ::ffff:0:0/96 35 4'],
  hosts: [
    'if exist "%SystemRoot%\\System32\\drivers\\etc\\hosts.rainbowmc.bak" copy "%SystemRoot%\\System32\\drivers\\etc\\hosts.rainbowmc.bak" "%SystemRoot%\\System32\\drivers\\etc\\hosts" /Y',
    'ipconfig /flushdns >nul'
  ]
}

export interface ScriptResult {
  ok: boolean
  applyPath?: string
  revertPath?: string
  message?: string
}

/** 生成「一键优化.bat / 一键还原.bat」，用户右键以管理员运行即可（不依赖程序自动提权） */
export function writeOptimizeScripts(ids: OptId[]): ScriptResult {
  try {
    const fs = require('fs') as typeof import('fs')
    const dir = join(paths.root(), 'tools')
    fs.mkdirSync(dir, { recursive: true })
    const header = [
      '@echo off',
      'chcp 65001 >nul',
      'title RAINBOW MC 联机优化',
      'net session >nul 2>&1',
      'if errorlevel 1 (',
      '  echo [需要管理员权限]',
      '  echo 请右键这个文件 -^> 以管理员身份运行',
      '  echo.',
      '  pause',
      '  exit /b 1',
      ')',
      'echo 正在应用联机优化...',
      ''
    ]
    const applyLines = [...header]
    for (const id of ids) applyLines.push(...(OPT_CMDS[id] ?? []), '')
    applyLines.push('echo.', 'echo 完成！回到启动器点「开始检测」看是否生效。', 'pause', '')

    const revertLines = [...header, 'echo 正在还原...', '']
    for (const id of ids) revertLines.push(...(REVERT_CMDS[id] ?? []), '')
    revertLines.push('echo.', 'echo 已还原。', 'pause', '')

    const applyPath = join(dir, '一键联机优化.bat')
    const revertPath = join(dir, '一键还原联机优化.bat')
    fs.writeFileSync(applyPath, applyLines.join('\r\n'), 'utf8')
    fs.writeFileSync(revertPath, revertLines.join('\r\n'), 'utf8')
    return { ok: true, applyPath, revertPath }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
