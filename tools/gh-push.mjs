#!/usr/bin/env node
/**
 * 推送公开版源码到 GitHub（令牌从本地密钥文件读取，不写进仓库）。
 *
 * 用法：
 *   node tools\gh-push.mjs                 # 只推源码
 *   node tools\gh-push.mjs --release 0.2.37 --asset app\release\RAINBOWMC-0.2.37-setup.exe
 *
 * 令牌文件：C:\Users\<你>\.dsh\.secrets\github-token.txt
 *   token=ghp_xxx
 *   repo=user/rainbow-mc
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SECRET = join(homedir(), '.dsh', '.secrets', 'github-token.txt')
if (!existsSync(SECRET)) {
  console.error('找不到令牌文件：' + SECRET)
  process.exit(1)
}
const conf = Object.fromEntries(
  readFileSync(SECRET, 'utf-8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const TOKEN = conf.token
const REPO = conf.repo
if (!TOKEN || !REPO) {
  console.error('令牌文件缺少 token 或 repo')
  process.exit(1)
}

const arg = (name, def = '') => {
  const i = process.argv.indexOf('--' + name)
  return i > -1 ? process.argv[i + 1] : def
}
const tag = arg('release')
const asset = arg('asset')

const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'rainbow-mc-push'
}

async function api(path, opts = {}) {
  const res = await fetch('https://api.github.com' + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${res.status} ${data?.message || ''}`)
  return data
}

function push(url) {
  const run = (args) => {
    try {
      return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return ((e.stdout || '') + (e.stderr || '')).toString()
    }
  }
  let out = run(`push ${url} HEAD:main`)
  if (/rejected|stale info/i.test(out)) {
    run(`fetch ${url} main`)
    out = run(`push ${url} HEAD:main`)
  }
  // 输出里可能带令牌，脱敏后再打
  console.log(out.replace(/x-access-token:[^@]+@/g, 'x-access-token:***@'))
}
async function main() {
  console.log('· 推送源码…')
  const url = `https://x-access-token:${TOKEN}@github.com/${REPO}.git`
  push(url)
  console.log('✅ 源码已推送')

  if (!tag) return
  const version = tag.replace(/^v/, '')
  console.log(`· 创建 Release v${version}…`)
  let rel
  try {
    rel = await api(`/repos/${REPO}/releases/tags/v${version}`)
    console.log('  已存在，复用')
  } catch {
    rel = await api(`/repos/${REPO}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: `v${version}`,
        name: `RAINBOW MC ${version}`,
        draft: false,
        prerelease: false,
        body: `## RAINBOW MC ${version}\n\nWindows 10 / 11 x64 安装包。首次启动会自动下载 Java 运行时与游戏资源。\n`
      })
    })
  }
  if (!asset) return
  const name = asset.split(/[\\/]/).pop()
  console.log(`· 上传 ${name}（${(statSync(asset).size / 1048576).toFixed(2)} MB）…`)
  const buf = readFileSync(asset)
  const res = await fetch(
    `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`,
    { method: 'POST', headers: { ...H, 'Content-Type': 'application/octet-stream' }, body: buf }
  )
  const j = await res.json()
  if (!res.ok) throw new Error(`上传失败 ${res.status} ${j.message || ''}`)
  console.log('✅ 安装包：' + j.browser_download_url)
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
