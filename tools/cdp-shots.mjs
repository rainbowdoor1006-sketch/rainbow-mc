/**
 * 通过 CDP 截取启动器界面（页面区域，不含窗口边框），用于宣传视频素材。
 * 用法：node tools\cdp-shots.mjs <outDir>
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const out = process.argv[2] || 'D:\\DeepSeek work\\projects\\RAINBOW-MC-启动器\\_promo\\shots'
mkdirSync(out, { recursive: true })

const base = 'http://127.0.0.1:' + (process.env.CDP_PORT || '9580')

const list = await (await fetch(base + '/json/list')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error)
    pending.delete(m.id)
  }
}
function send(method, params = {}) {
  const myId = ++id
  return new Promise((res) => {
    pending.set(myId, res)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function evaluate(expression) {
  return send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  if (!r.data) throw new Error('截图失败: ' + JSON.stringify(r))
  writeFileSync(out + '\\' + name + '.png', Buffer.from(r.data, 'base64'))
  console.log('saved', name)
}

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 900,
  deviceScaleFactor: 2,
  mobile: false
})
await sleep(600)

const clickTab = (text) => `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(text)})
  b?.click(); return !!b
})()`

// 1. 启动页
await evaluate(clickTab('启动'))
await sleep(700)
await shot('01-launch')

// 2. 下载 → 模组
await evaluate(clickTab('下载'))
await sleep(500)
await evaluate(clickTab('模组'))
await sleep(2500)
await shot('02-mods')

// 3. 下载 → 游戏版本
await evaluate(clickTab('游戏版本'))
await sleep(1800)
await shot('03-versions')

// 4. 下载 → 整合包
await evaluate(clickTab('整合包'))
await sleep(2200)
await shot('04-modpacks')

// 5. 组件库
await evaluate(clickTab('组件库'))
await sleep(900)
await shot('05-library')

// 6. 设置
await evaluate(clickTab('设置'))
await sleep(900)
await shot('06-settings')

// 7. 账号列表弹窗（先回启动页，再点侧栏昵称）
await evaluate(clickTab('启动'))
await sleep(600)
await evaluate(`(() => {
  const n = document.querySelector('.avatar-name')
  n?.click(); return !!n
})()`)
await sleep(1000)
const hasModal = await evaluate(`document.querySelectorAll('.modal').length`)
console.log('accounts modal:', JSON.stringify(hasModal.result?.value))
await shot('07-accounts')
await evaluate(`(() => {
  const b = [...document.querySelectorAll('.modal-actions button')].find((x) => x.innerText.trim())
  b?.click(); return true
})()`)
await sleep(400)

// 8. 设置页（单独一张）
await evaluate(clickTab('设置'))
await sleep(900)
await shot('08-settings')

ws.close()
console.log('done ->', out)
