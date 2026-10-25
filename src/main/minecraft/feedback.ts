import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { cpus, release, totalmem } from 'os'
import { paths } from '../paths'
import { hardware } from './sysinfo'
import { projectSummary } from './stats'
import { checkMods } from './modcheck'
import type { GameProject } from '@shared/types'

/**
 * 崩溃反馈打包：把「能定位问题」的东西打成 zip，用户直接发给作者。
 *
 * 内容：latest.log、最近 3 份崩溃报告、系统与硬件信息、项目概况、模组体检结果、启动器版本
 * 不包含：账号令牌、密码、路径中的用户名（已脱敏）
 */

function tail(file: string, bytes = 2_000_000): string {
  try {
    return readFileSync(file).subarray(Math.max(0, statSync(file).size - bytes)).toString('utf8')
  } catch {
    return ''
  }
}

function maskUser(text: string): string {
  // 把 C:\Users\xxx 换成 C:\Users\***
  return text.replace(/([A-Za-z]:\\Users\\)[^\\/\s]+/gi, '$1***')
}

export interface FeedbackResult {
  ok: boolean
  path?: string
  sizeMb?: number
  message?: string
}

export function buildFeedbackZip(project: GameProject | undefined, extraLog?: string): FeedbackResult {
  try {
    const zip = new AdmZip()
    const inst = project ? join(paths.games(), project.dir) : ''

    // 1. 启动器日志（当前运行日志）
    const now = new Date()
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`

    if (extraLog) zip.addFile('launcher-error.txt', Buffer.from(maskUser(extraLog), 'utf8'))

    // 2. 游戏日志
    if (inst) {
      const latest = join(inst, 'logs', 'latest.log')
      if (existsSync(latest)) {
        zip.addFile('latest.log', Buffer.from(maskUser(tail(latest)), 'utf8'))
      }
      const debugLog = join(inst, 'logs', 'debug.log')
      if (existsSync(debugLog)) {
        zip.addFile('debug.log.tail.txt', Buffer.from(maskUser(tail(debugLog, 500_000)), 'utf8'))
      }
      // 3. 最近 3 份崩溃报告
      const crashDir = join(inst, 'crash-reports')
      if (existsSync(crashDir)) {
        const crs = readdirSync(crashDir)
          .filter((f) => f.endsWith('.txt'))
          .map((f) => ({ f, at: statSync(join(crashDir, f)).mtimeMs }))
          .sort((a, b) => b.at - a.at)
          .slice(0, 3)
        for (const c of crs) {
          zip.addFile('crash-reports/' + c.f, Buffer.from(maskUser(tail(join(crashDir, c.f), 400_000)), 'utf8'))
        }
      }
    }

    // 4. 系统与硬件
    const hw = hardware()
    const sys = [
      `RAINBOW MC ${app.getVersion()}`,
      `系统: Windows ${release()}`,
      `CPU: ${hw.cpuModel} (${hw.cpuCores} 核)`,
      `内存: 共 ${Math.round(hw.totalRamMb / 1024)} GB / 可用 ${Math.round(hw.freeRamMb / 1024)} GB`,
      `显卡: ${hw.gpuName}${hw.gpuVramMb ? ` (${(hw.gpuVramMb / 1024).toFixed(1)} GB)` : ''}`,
      `其他显卡: ${hw.gpus.map((g) => g.name).join(' / ') || '—'}`,
      `CPU 基准频率: ${hw.cpuMhz} MHz`,
      `逻辑处理器数: ${cpus().length}`,
      `物理内存字节: ${totalmem()}`,
      `时间: ${now.toISOString()}`
    ].join('\n')
    zip.addFile('system.txt', Buffer.from(sys, 'utf8'))

    // 5. 项目概况 + 模组体检
    if (project) {
      const sum = projectSummary(project)
      const info = [
        `项目名: ${project.name}`,
        `MC 版本: ${project.mcVersion}`,
        `加载器: ${project.loader} ${project.loaderVersion ?? ''}`,
        `versionId: ${project.versionId ?? '（未设置）'}`,
        `内存分配: ${project.memoryMb ? project.memoryMb + ' MB' : '（跟随全局）'}`,
        `模组: ${sum.mods} 个 / 光影: ${sum.shaders} / 资源包: ${sum.resourcePacks} / 存档: ${sum.saves}`,
        `体积: ${sum.totalMb} MB`,
        `构成: ${sum.breakdown.map((b) => `${b.label} ${b.mb}MB`).join(' · ')}`,
        `上次启动耗时: ${project.lastBootMs ? (project.lastBootMs / 1000).toFixed(1) + 's' : '—'}`,
        `最快启动耗时: ${project.bestBootMs ? (project.bestBootMs / 1000).toFixed(1) + 's' : '—'}`,
        `启动次数: ${project.launchCount ?? 0}`
      ].join('\n')
      zip.addFile('project.txt', Buffer.from(info, 'utf8'))

      try {
        const chk = checkMods(project)
        const lines = [
          `jar: ${chk.jars} / 识别模组: ${chk.mods} / 耗时: ${chk.elapsedMs}ms`,
          '',
          ...chk.issues.map(
            (i) => `[${i.level === 'error' ? '错误' : '警告'}] ${i.title}\n  ${i.detail}${i.files ? '\n  文件: ' + i.files.join(', ') : ''}`
          )
        ]
        zip.addFile('modcheck.txt', Buffer.from(maskUser(lines.join('\n')), 'utf8'))
      } catch {
        /* ignore */
      }
    }

    const outDir = join(paths.root(), 'exports')
    mkdirSync(outDir, { recursive: true })
    const out = join(outDir, `RAINBOWMC-反馈-${stamp}.zip`)
    zip.writeZip(out)
    const sizeMb = Math.round((statSync(out).size / 1048576) * 100) / 100
    return { ok: true, path: out, sizeMb }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** 托盘提示用：读游戏进程占用内存（MB），读不到返回 0 */
export function processMemoryMb(pid: number): number {
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process')
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000
    })
    // "javaw.exe","12345","Console","1","5,123,456 K"
    const m = out.match(/"([^"]+)","(\d+)".*?"([\d,\s]+) K"/)
    if (!m) return 0
    const kb = parseInt(m[3].replace(/[,\s]/g, ''), 10)
    return Math.round(kb / 1024)
  } catch {
    return 0
  }
}
