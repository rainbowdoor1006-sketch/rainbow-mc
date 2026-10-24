#!/usr/bin/env node
/**
 * 通过 GitHub REST API 把本地仓库上传成远端仓库（本机 git 协议被封时用）。
 *
 * 用法（PowerShell）：
 *   $env:GH_TOKEN = 'ghp_xxx'
 *   node tools\gh-upload.mjs --repo rainbow-mc --asset "app\release\RAINBOWMC-0.2.28-setup.exe" --tag v0.2.28
 *
 * 做的事：
 *   1. GET /user 拿到用户名
 *   2. POST /user/repos 建仓库（已存在则跳过）
 *   3. 按 git ls-files 逐个上传 blob → 建 tree → 建 commit → 建 ref refs/heads/main（一次提交）
 *   4. 建 release 并上传安装包
 *
 * 注意：仓库里已排除 node_modules / release / 记忆文件；token 只在内存里用，不落盘。
 */
import { execSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const API = 'https://api.github.com'
const UPLOAD = 'https://uploads.github.com'

function arg(name, def = '') {
  const i = process.argv.indexOf('--' + name)
  return i > -1 ? process.argv[i + 1] : def
}

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
const REPO = arg('repo', 'rainbow-mc')
const DESC = arg('desc', '开源 Minecraft 启动器 · Electron + React · 一键安装加载器/整合包')
const ASSET = arg('asset', '')
const TAG = arg('tag', '')
const PRIVATE = arg('private', 'false') === 'true'

if (!TOKEN) {
  console.error('缺少 GH_TOKEN 环境变量')
  process.exit(1)
}

const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'rainbow-mc-uploader'
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { ...H, ...(opts.headers || {}) }
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const msg = data && data.message ? data.message : String(text).slice(0, 300)
    const err = new Error(`${opts.method || 'GET'} ${path} → ${res.status} ${msg}`)
    err.status = res.status
    throw err
  }
  return data
}

async function main() {
  console.log('· 校验 token…')
  const me = await api('/user')
  const owner = me.login
  console.log(`  登录为 ${owner}`)

  console.log(`· 确保仓库 ${owner}/${REPO} 存在…`)
  let repo
  try {
    repo = await api(`/repos/${owner}/${REPO}`)
    console.log('  仓库已存在，直接复用')
  } catch (e) {
    if (e.status !== 404) throw e
    repo = await api('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: REPO,
        description: DESC,
        private: PRIVATE,
        has_issues: true,
        has_wiki: false,
        auto_init: false
      })
    })
    console.log('  已创建仓库')
  }

  const branch = 'main'

  console.log('· 读取本地文件清单（git ls-files）…')
  const files = execSync('git ls-files', { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  console.log(`  共 ${files.length} 个文件`)

  // 远端已有 main 的话，用它做 parent（让提交可叠加）
  let parentSha = null
  try {
    const ref = await api(`/repos/${owner}/${REPO}/git/ref/heads/${branch}`)
    parentSha = ref.object.sha
    console.log('  远端已有 main，将基于它新增提交')
  } catch {
    /* 空仓库 */
  }

  console.log('· 上传文件内容（blob）…')
  const tree = []
  let n = 0
  for (const f of files) {
    let buf
    try {
      buf = readFileSync(f)
    } catch {
      continue
    }
    // 大文件走 base64 也可，但 GitHub blob 上限 100MB，源码都很小
    const blob = await api(`/repos/${owner}/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' })
    })
    tree.push({ path: f.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: blob.sha })
    n++
    if (n % 20 === 0) console.log(`  已传 ${n}/${files.length}`)
  }
  console.log(`  blob 完成：${tree.length}`)

  console.log('· 建 tree…')
  const newTree = await api(`/repos/${owner}/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree })
  })

  console.log('· 建 commit…')
  const commit = await api(`/repos/${owner}/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: 'feat: RAINBOW MC 启动器首次开源提交（含源码、文档、构建脚本）',
      tree: newTree.sha,
      parents: parentSha ? [parentSha] : []
    })
  })

  console.log('· 更新分支…')
  if (parentSha) {
    await api(`/repos/${owner}/${REPO}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false })
    })
  } else {
    await api(`/repos/${owner}/${REPO}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha })
    })
  }
  await api(`/repos/${owner}/${REPO}`, {
    method: 'PATCH',
    body: JSON.stringify({ default_branch: branch })
  })

  console.log(`✅ 源码已上传：https://github.com/${owner}/${REPO}`)

  if (ASSET && TAG) {
    console.log(`· 建 release ${TAG}…`)
    let rel
    try {
      rel = await api(`/repos/${owner}/${REPO}/releases/tags/${TAG}`)
    } catch {
      rel = await api(`/repos/${owner}/${REPO}/releases`, {
        method: 'POST',
        body: JSON.stringify({
          tag_name: TAG,
          name: `RAINBOW MC ${TAG.replace(/^v/, '')}`,
          body: [
            '## RAINBOW MC ' + TAG.replace(/^v/, ''),
            '',
            'Windows 10/11 x64 安装包。首次启动会自动下载 Java 运行时与游戏资源。',
            '',
            '### 本版重点',
            '- 自动下载游戏资源（语言 / 声音 / 字体）',
            '- CurseForge 整合包免 API Key 导入',
            '- Forge 早期窗口自动关闭（修复启动崩溃）',
            '- 启动阶段日志 + 崩溃自动诊断',
            '- 覆盖安装/卸载始终保留 data/（存档、组件库、游戏文件）'
          ].join('\n'),
          draft: false,
          prerelease: false
        })
      })
    }
    const name = ASSET.split(/[\\/]/).pop()
    const size = statSync(ASSET).size
    console.log(`· 上传安装包 ${name}（${(size / 1048576).toFixed(1)} MB）…`)
    const buf = readFileSync(ASSET)
    const res = await fetch(
      `${UPLOAD}/repos/${owner}/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: {
          ...H,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(buf.length)
        },
        body: buf
      }
    )
    const j = await res.json()
    if (!res.ok) throw new Error(`上传安装包失败：${res.status} ${j.message || ''}`)
    console.log(`✅ 安装包已上传：${j.browser_download_url}`)
  }
}

main().catch((e) => {
  console.error('❌ 失败：', e.message)
  process.exit(1)
})
