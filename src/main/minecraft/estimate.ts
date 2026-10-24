import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { paths } from '../paths'
import { cpuTier, hardware, type HardwareInfo } from './sysinfo'
import type { GameProject } from '@shared/types'

/**
 * 启动前资源预估。
 *
 * 全部是**工程估算**，不是精确测量：
 *   · 内存：模组会常驻类与贴图，按每模组 22 MB 估（实测 564 模组包约 12~15 GB 波动）
 *   · 显存：原版 1.5 GB；光影 +1 GB；大资源包 +0.5 GB；大整合包 +0.5 GB
 *   · CPU：按模组量与加载器判断负载等级，再对比 CPU 档次
 */

export interface Estimate {
  /** 预计占用的堆内存（MB） */
  ramMb: number
  /** 当前项目设置的内存（MB），0 表示未设置 */
  allocatedMb: number
  /** 预计显存占用（MB） */
  vramMb: number
  /** CPU 负载：light / medium / heavy / extreme */
  cpuLoad: 'light' | 'medium' | 'heavy' | 'extreme'
  cpuLoadText: string
  /** 需要的 CPU 档次 1~4 */
  cpuNeedTier: number
  mods: number
  shaderPacks: number
  resourcePackMb: number
  hardware: HardwareInfo
  /** 结论：ok / ram / vram / cpu */
  problems: ('ram' | 'vram' | 'cpu')[]
  /** 给用户看的建议文案 */
  advice: string[]
}

function countJars(dir: string): number {
  try {
    return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar')).length
  } catch {
    return 0
  }
}

function dirSizeMb(dir: string): number {
  try {
    let sum = 0
    for (const f of readdirSync(dir)) {
      try {
        const st = statSync(join(dir, f))
        if (st.isFile()) sum += st.size
      } catch {
        /* ignore */
      }
    }
    return sum / 1048576
  } catch {
    return 0
  }
}

const LOAD_TEXT = {
  light: '轻量',
  medium: '中等',
  heavy: '较高',
  extreme: '很高'
} as const

export function estimateProject(project: GameProject): Estimate {
  const inst = join(paths.games(), project.dir)
  const mods = countJars(join(inst, 'mods'))
  const shaderPacks = (() => {
    try {
      return readdirSync(join(inst, 'shaderpacks')).filter((f) => f.toLowerCase().endsWith('.zip')).length
    } catch {
      return 0
    }
  })()
  const resourcePackMb = Math.round(dirSizeMb(join(inst, 'resourcepacks')))

  const hw = hardware()

  // 内存：3 GB 起步 + 每模组 22 MB；有光影再 +1 GB
  let ramMb = 3072 + mods * 22 + (shaderPacks ? 1024 : 0)
  ramMb = Math.min(ramMb, 24576)
  ramMb = Math.ceil(ramMb / 512) * 512

  // 显存：原版 1.5 GB；光影 +1 GB；大资源包 +0.5 GB；大包 +0.5 GB
  let vramMb = 1536
  if (shaderPacks) vramMb += 1024
  if (resourcePackMb > 200) vramMb += 512
  if (mods > 300) vramMb += 512
  vramMb = Math.ceil(vramMb / 256) * 256

  // CPU 负载与档次需求
  let cpuLoad: Estimate['cpuLoad'] = 'light'
  if (mods >= 600) cpuLoad = 'extreme'
  else if (mods >= 300) cpuLoad = 'heavy'
  else if (mods >= 80) cpuLoad = 'medium'
  const cpuNeedTier = cpuLoad === 'extreme' ? 3 : cpuLoad === 'heavy' ? 2 : 1

  const problems: Estimate['problems'] = []
  const advice: string[] = []

  const allocatedMb = project.memoryMb || 0
  const usable = Math.round(hw.totalRamMb * 0.6)
  if (allocatedMb && allocatedMb < ramMb) {
    problems.push('ram')
    advice.push(
      `该项目可能需要的预留内存约 ${Math.ceil(ramMb / 1024)} GB，当前分配只有 ${Math.round(allocatedMb / 1024)} GB。可前往「版本设置 → 内存」调整分配。`
    )
  } else if (ramMb > usable) {
    problems.push('ram')
    advice.push(
      `项目预计需要约 ${Math.ceil(ramMb / 1024)} GB 内存，已超过本机可用上限（约 ${Math.floor(usable / 1024)} GB），可能会出现卡顿或内存溢出。`
    )
  }

  if (hw.gpuVramMb > 0 && vramMb > hw.gpuVramMb) {
    problems.push('vram')
    advice.push(
      `该项目可能超出你当前显卡（${hw.gpuName}，${(hw.gpuVramMb / 1024).toFixed(1)} GB 显存）的显存容量，建议显存 ${Math.ceil(vramMb / 1024)} GB 以上的显卡；可降低渲染距离或关闭光影。`
    )
  }

  const tier = cpuTier(hw.cpuModel)
  if (tier < cpuNeedTier) {
    problems.push('cpu')
    advice.push(
      `该项目模组数量较多（${mods} 个），可能需要更高性能的 CPU 才能保持流畅；当前 CPU（${hw.cpuModel}）属于入门级，建议使用 i5 / R5 及以上。`
    )
  }

  if (allocatedMb === 0 && ramMb > 8192) {
    advice.push(`建议把内存分配调到 ${Math.ceil(ramMb / 1024)} GB 以上（版本设置 → 内存）。`)
  }
  if (!advice.length) {
    advice.push('当前配置可以满足该项目运行，未发现明显风险。')
  }

  return {
    ramMb,
    allocatedMb,
    vramMb,
    cpuLoad,
    cpuLoadText: LOAD_TEXT[cpuLoad],
    cpuNeedTier,
    mods,
    shaderPacks,
    resourcePackMb,
    hardware: hw,
    problems,
    advice
  }
}
