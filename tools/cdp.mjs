// CDP 工具（真实鼠标事件版）
// node cdp.mjs "<js>"                      读/执行
// node cdp.mjs --goto "url" [--wait ms]    跳转并读
// node cdp.mjs --rect "文字"               打印元素中心坐标
// node cdp.mjs --at x y                    真实鼠标点击坐标
// node cdp.mjs --rectclick "文字"          找到元素→真实点击→读页面
const argv = process.argv.slice(2)
const mode = argv[0]
const a1 = argv[1]
const a2 = argv[2]
const waitIdx = argv.indexOf('--wait')
const waitMs = waitIdx >= 0 ? Number(argv[waitIdx + 1]) : 4000

const PORT = process.env.CDP_PORT || '9222'
const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json()
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.log('NO_PAGE')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg.error)
    pending.delete(msg.id)
  }
})
await new Promise((r) => ws.addEventListener('open', r))
await send('Page.enable')
await send('Runtime.enable')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.value
}

const centerOf = async (text) => {
  const expr = `(() => {
    const needle = ${JSON.stringify(text)}.toLowerCase();
    const els = [...document.querySelectorAll('label,button,a,[role=option],span,div')]
      .filter(e => ((e.innerText||'').trim().toLowerCase().includes(needle)) && e.offsetParent !== null);
    if (!els.length) return null;
    const el = els[els.length - 1];
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), tag: el.tagName, text: (el.innerText||'').trim().slice(0,40) };
  })()`
  return evalJs(expr)
}

const realClick = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

if (mode === '--goto') {
  await send('Page.navigate', { url: a1 })
  await sleep(waitMs)
  console.log(await evalJs("location.href + '\\n---\\n' + document.body.innerText.replace(/\\s+/g,' ').slice(0,1500)"))
} else if (mode === '--rect') {
  console.log(JSON.stringify(await centerOf(a1)))
} else if (mode === '--at') {
  await realClick(Number(a1), Number(a2))
  console.log('clicked ' + a1 + ',' + a2)
} else if (mode === '--rectclick') {
  const c = await centerOf(a1)
  if (!c) {
    console.log('NOT_FOUND')
  } else {
    await realClick(c.x, c.y)
    await sleep(2500)
    console.log('clicked ' + JSON.stringify(c))
    console.log(await evalJs("document.body.innerText.replace(/\\s+/g,' ').slice(0,600)"))
  }
} else {
  console.log(await evalJs(mode))
}
ws.close()
process.exit(0)
