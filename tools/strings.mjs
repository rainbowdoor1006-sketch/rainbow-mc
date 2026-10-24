import { readFileSync } from 'fs'

const file = process.argv[2]
const buf = readFileSync(file)

// 提取 UTF-16LE 与 ASCII 字符串
const utf16 = []
let cur = []
for (let i = 0; i + 1 < buf.length; i += 2) {
  const code = buf.readUInt16LE(i)
  if (code >= 0x20 && code < 0x7f) cur.push(String.fromCharCode(code))
  else {
    if (cur.length >= 4) utf16.push(cur.join(''))
    cur = []
  }
}
if (cur.length >= 4) utf16.push(cur.join(''))

const ascii = []
cur = []
for (let i = 0; i < buf.length; i++) {
  const b = buf[i]
  if (b >= 0x20 && b < 0x7f) cur.push(String.fromCharCode(b))
  else {
    if (cur.length >= 6) ascii.push(cur.join(''))
    cur = []
  }
}
if (cur.length >= 6) ascii.push(cur.join(''))

const all = [...new Set([...utf16, ...ascii])]
const needles = ['login.microsoftonline', 'oauth2', 'consumers', 'xboxlive', 'devicecode', 'device_code', 'onmicrosoft', 'client_id', 'live.com']
const hits = all.filter((s) => needles.some((n) => s.toLowerCase().includes(n)))
console.log('=== endpoint/oauth hits: ' + hits.length + ' ===')
for (const h of hits.slice(0, 40)) console.log('  ' + h.slice(0, 260))

const guids = [...new Set(all.join('\n').match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g) ?? [])]
console.log('=== guids: ' + guids.length + ' ===')
for (const g of guids.slice(0, 30)) console.log('  ' + g)
