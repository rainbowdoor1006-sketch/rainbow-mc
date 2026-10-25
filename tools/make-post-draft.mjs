#!/usr/bin/env node
/**
 * 生成「爱发电动态 / B站简介 / 论坛帖」的现成草稿。
 * 用法：node tools\make-post-draft.mjs [--version 0.2.33] [--notes "修复xxx；新增yyy"]
 *
 * 下载只写夸克网盘链接（不写网站直链）。
 * 可用环境变量覆盖：QUARK_LINK / QUARK_CODE
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const ROOT = 'D:\\DeepSeek work\\projects\\RAINBOW-MC-启动器'
const pkg = JSON.parse(readFileSync(join(ROOT, 'app', 'package.json'), 'utf8'))
const version = (process.argv.includes('--version')
  ? process.argv[process.argv.indexOf('--version') + 1]
  : pkg.version
).trim()
const notesIdx = process.argv.indexOf('--notes')
const notes = notesIdx > -1 ? process.argv[notesIdx + 1] : ''

const QUARK = process.env.QUARK_LINK || 'https://pan.quark.cn/s/6ed1bec2fb77'
const QUARK_CODE = process.env.QUARK_CODE || '/~692c3bgYtc~/'

const installer = join(ROOT, 'app', 'release', `RAINBOWMC-${version}-setup.exe`)
const stat = statSync(installer)
const sha = createHash('sha256').update(readFileSync(installer)).digest('hex')
const sizeMB = (stat.size / 1048576).toFixed(2)
const sizeBytes = stat.size

const notesLine = notes || ''

const afdian = `RAINBOW MC 启动器 v${version}

免费开源的 Minecraft 启动器：下载即玩，Java 运行时、加载器、缺失的游戏文件都会自动处理好。
支持 Forge / NeoForge / Fabric / Quilt 一键安装；支持拖入 Modrinth 与 CurseForge 整合包，
自动补齐全部模组；支持微软正版、社团账号、纯离线三种登录。

【下载】
${QUARK}
手机打开夸克 App 可搜口令：${QUARK_CODE}

文件信息
  版本：${version}
  大小：${sizeBytes} 字节（${sizeMB} MB）
  SHA256：${sha}
  系统要求：Windows 10 / 11 x64

本作品全部功能免费，不需要赞助即可使用；新版本会覆盖更新到上面这个网盘链接。

${notesLine}
`

const bili = `【下载】${QUARK}
夸克 App 搜口令：${QUARK_CODE}
版本 ${version} · ${sizeMB} MB · Windows 10/11
SHA256: ${sha.slice(0, 16)}…${sha.slice(-8)}
免费开源，无付费墙`

const forum = `# [启动器] RAINBOW MC · 免配置开箱即玩（v${version}）

一个免费开源的 Minecraft 启动器：**下载 → 双击 → 选版本 → 点启动**，
Java 运行时、加载器、缺失的游戏文件全部自动处理。

## 功能

- 一键安装 Forge / NeoForge / Fabric / Quilt
- 启动前自动补齐缺失的库文件与游戏资源
- 整合包拖入即导入（Modrinth / CurseForge），自动下载全部模组
- 内置 Modrinth 资源下载（模组 / 光影 / 资源包）
- 三种登录：微软正版 / 社团账号 / 离线（无需账号）
- 覆盖安装与卸载都不删除存档与组件库
- 崩溃时自动生成日志并给出原因

## 下载

${QUARK}

夸克 App 搜口令：${QUARK_CODE}

\`\`\`
版本 ${version}
大小 ${sizeBytes} 字节（${sizeMB} MB）
SHA256 ${sha}
\`\`\`

## 更新说明

${notesLine || '（自行补充）'}

## 说明

- 仅支持 Windows 10 / 11 x64
- 首次启动会自动下载 Java 运行时与游戏资源，请耐心等待
- 遇到问题请在本帖回复并附上启动器日志（启动失败时会生成 ZIP）
`

const outDir = join(ROOT, '_promo', '发布草稿')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, `爱发电-${version}.md`), afdian, 'utf8')
writeFileSync(join(outDir, `B站简介-${version}.txt`), bili, 'utf8')
writeFileSync(join(outDir, `论坛帖-${version}.md`), forum, 'utf8')

console.log('version :', version)
console.log('size    :', sizeBytes, `(${sizeMB} MB)`)
console.log('sha256  :', sha)
console.log('quark   :', QUARK)
console.log('drafts  :', outDir)
