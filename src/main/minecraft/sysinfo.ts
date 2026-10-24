import { execFileSync } from 'child_process'
import { cpus, totalmem, freemem } from 'os'

/**
 * 硬件信息采集（Windows 优先走注册表/CIM，取不到就降级）。
 * 结果带缓存，避免每次启动都调 PowerShell。
 */

export interface HardwareInfo {
  totalRamMb: number
  freeRamMb: number
  cpuModel: string
  cpuCores: number
  cpuMhz: number
  gpuName: string
  gpuVramMb: number
  gpus: { name: string; vramMb: number }[]
}

let cache: HardwareInfo | null = null

function runPs(script: string): string {
  try {
    return execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 12000, windowsHide: true }
    ).trim()
  } catch {
    return ''
  }
}

/** 从注册表读真实显存（AdapterRAM 在 4GB 以上会溢出，不可靠） */
function vramFromRegistry(): { name: string; vramMb: number }[] {
  const script = `
$out = @()
Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue |
  Where-Object { $_.PSChildName -match '^\\d{4}$' } | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($p.'HardwareInformation.qwMemorySize' -and $p.DriverDesc) {
      $out += ('{0}|{1}' -f $p.DriverDesc, [int64]$p.'HardwareInformation.qwMemorySize')
    }
  }
$out -join "\`n"
`
  const raw = runPs(script)
  const list: { name: string; vramMb: number }[] = []
  for (const line of raw.split(/\r?\n/)) {
    const [name, bytes] = line.split('|')
    if (!name || !bytes) continue
    const mb = Math.round(Number(bytes) / 1048576)
    if (mb > 0 && mb < 200000) list.push({ name: name.trim(), vramMb: mb })
  }
  return list
}

export function hardware(): HardwareInfo {
  if (cache) return cache
  const cs = cpus()
  const totalRamMb = Math.round(totalmem() / 1048576)
  const freeRamMb = Math.round(freemem() / 1048576)

  let gpus = vramFromRegistry()
  if (!gpus.length) {
    const raw = runPs(
      `Get-CimInstance Win32_VideoController | ForEach-Object { '{0}|{1}' -f $_.Name, $_.AdapterRAM }`
    )
    for (const line of raw.split(/\r?\n/)) {
      const [name, bytes] = line.split('|')
      if (!name) continue
      const mb = Math.round(Number(bytes || 0) / 1048576)
      gpus.push({ name: name.trim(), vramMb: mb > 0 && mb < 200000 ? mb : 0 })
    }
  }
  // 优先独显：显存大的排前面
  gpus.sort((a, b) => b.vramMb - a.vramMb)
  const main = gpus[0] ?? { name: '未知显卡', vramMb: 0 }

  cache = {
    totalRamMb,
    freeRamMb,
    cpuModel: cs[0]?.model?.trim() || '未知 CPU',
    cpuCores: cs.length,
    cpuMhz: cs[0]?.speed ?? 0,
    gpuName: main.name,
    gpuVramMb: main.vramMb,
    gpus
  }
  return cache
}

/** CPU 档次：1=入门 2=主流 3=高性能 4=发烧 */
export function cpuTier(model: string): number {
  const m = model.toLowerCase()
  const has = (re: RegExp): boolean => re.test(m)
  let tier = 2

  // Intel: i3 / i5 / i7 / i9（含 ultra 系列）
  if (has(/\bi3\b|ultra 3/)) tier = 1
  else if (has(/\bi5\b|ultra 5/)) tier = 2
  else if (has(/\bi7\b|ultra 7/)) tier = 3
  else if (has(/\bi9\b|ultra 9/)) tier = 4
  // AMD Ryzen 3/5/7/9
  if (has(/ryzen\s*3/)) tier = Math.min(tier, 1)
  if (has(/ryzen\s*5/)) tier = Math.max(tier, 2)
  if (has(/ryzen\s*7/)) tier = Math.max(tier, 3)
  if (has(/ryzen\s*9/)) tier = 4
  // 老架构/低功耗后缀降一档（U 结尾常见于轻薄本）
  if (has(/-\d{4,5}u\b|u\s*$/) && tier > 1) tier -= 1
  return tier
}
