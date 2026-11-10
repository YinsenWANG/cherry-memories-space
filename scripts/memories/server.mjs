#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const port = 16808
const backend = process.env.SIYUAN_URL || 'http://127.0.0.1:16807'
let startError = process.env.SIYUAN_START_ERROR || ''
let token = process.env.SIYUAN_TOKEN
if (!token && process.env.SIYUAN_WORKSPACE) {
  try {
    token = JSON.parse(await readFile(join(process.env.SIYUAN_WORKSPACE, 'conf', 'conf.json'), 'utf8')).api.token
  } catch {
    // A fresh installation may not have a kernel or workspace yet.
  }
}
const escapeHtml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
const editorUrl = new URL(backend)
if (!['http:', 'https:'].includes(editorUrl.protocol) || editorUrl.username || editorUrl.password) {
  throw new Error('Invalid Space backend URL')
}
const require = createRequire(import.meta.url)
const i18next = require(process.env.MEMORIES_I18NEXT_FILE || 'i18next').createInstance()
const localeDir = process.env.MEMORIES_LOCALES_DIR || join(dir, '../../src/main/i18n/locales')
const requestedLanguage = (process.env.MEMORIES_LANGUAGE || 'en-us').toLowerCase()
const language = /^[a-z]{2}-[a-z]{2}$/.test(requestedLanguage) ? requestedLanguage : 'en-us'
let catalog
try {
  catalog = JSON.parse(await readFile(join(localeDir, `${language}.json`), 'utf8'))
} catch {
  catalog = JSON.parse(await readFile(join(localeDir, 'en-us.json'), 'utf8'))
}
await i18next.init({
  lng: language,
  resources: { [language]: { translation: catalog } },
  keySeparator: false,
  lowerCaseLng: true
})
const tr = (key) => escapeHtml(i18next.t(`space.ui.${key}`))
const messages = Object.fromEntries(
  ['connected', 'missing', 'port', 'failed', 'initializing', 'initialized', 'copied'].map((key) => [
    key,
    i18next.t(`space.ui.${key}`)
  ])
)
const clientMessages = JSON.stringify(messages).replaceAll('<', '\\u003c')
const prompt = '使用这个指南帮我设置 Cherry-Studio-Memories 作为我的上下文系统：http://127.0.0.1:16808/setup'
const page = `<!doctype html><html lang="${escapeHtml(language)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${tr('title')}</title><style>body{font:16px system-ui,sans-serif;line-height:1.6;max-width:760px;margin:3rem auto;padding:0 1.3rem;color-scheme:light dark;background:Canvas;color:CanvasText}button,a.button{display:inline-block;background:#a62749;color:white;border:0;border-radius:7px;padding:.7rem 1rem;margin:.3rem .4rem .3rem 0;text-decoration:none;cursor:pointer;font-size:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:color-mix(in srgb, CanvasText 8%, Canvas);padding:1rem;border-radius:8px}small{color:GrayText}</style><h1>${tr('title')}</h1><p>${tr('intro')}</p><p id="status">${tr('checking')}</p><button id="init">${tr('initialize')}</button><a class="button" href="${escapeHtml(editorUrl.href)}" target="_blank" rel="noopener">${tr('open')}</a><p>${tr('prompt')}</p><pre id="prompt">${escapeHtml(prompt)}</pre><button id="copy">${tr('copy')}</button><p><a href="/setup">${tr('setup')}</a> · <a href="https://github.com/siyuan-note/siyuan/releases">${tr('download')}</a></p><small>${tr('tip')}</small><script>
const status=document.getElementById('status');const m=${clientMessages};
async function check(){try{const r=await fetch('/status');const x=await r.json();const reasons={missing_kernel:m.missing,port_in_use:m.port,initialization_failed:m.failed,startup_failed:m.failed};status.textContent=x.reason?reasons[x.reason]:x.ready?m.connected:m.failed}catch{status.textContent=m.failed}}
document.getElementById('init').onclick=async()=>{status.textContent=m.initializing;try{const r=await fetch('/init',{method:'POST'});status.textContent=r.ok?m.initialized:m.failed}catch{status.textContent=m.failed}};
document.getElementById('copy').onclick=async()=>{const text=document.getElementById('prompt').textContent;const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.left='-10000px';document.body.appendChild(input);input.focus();input.select();const copied=document.execCommand('copy');input.remove();try{if(!copied)await navigator.clipboard.writeText(text);status.textContent=m.copied}catch{status.textContent=m.failed}};check();
</script></html>`
let initializing = false
const server = createServer(async (req, res) => {
  const host = req.headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    res.writeHead(403).end()
    return
  }
  const send = (status, type, body) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(body)
  }
  const json = (status, body) => send(status, 'application/json; charset=utf-8', JSON.stringify(body))
  if (req.method === 'GET' && req.url === '/') return send(200, 'text/html; charset=utf-8', page)
  if (req.method === 'GET' && req.url === '/setup') {
    const guide = await readFile(join(dir, '../../docs/setup.md'), 'utf8')
    return send(
      200,
      'text/html; charset=utf-8',
      `<!doctype html><meta charset="utf-8"><title>${tr('setup')}</title><pre style="white-space:pre-wrap">${escapeHtml(guide)}</pre>`
    )
  }
  if (req.method === 'GET' && req.url === '/status') {
    let ready = false
    if (token)
      try {
        const response = await fetch(new URL('/api/system/version', backend), {
          method: 'POST',
          headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(5000)
        })
        ready = response.ok && (await response.json()).code === 0
      } catch {
        /* The sidecar has not started yet. */
      }
    return json(200, { ready, reason: startError })
  }
  if (req.method === 'POST' && req.url === '/init') {
    if (req.headers.origin !== `http://${host}`) return json(403, { error: 'Invalid origin' })
    if (!token) return json(400, { error: 'Set SIYUAN_WORKSPACE or SIYUAN_TOKEN before starting Memories.' })
    if (initializing) return json(409, { error: 'Initialization is already running.' })
    initializing = true
    const child = spawn(process.execPath, [join(dir, 'bootstrap.mjs')], {
      env: { ...process.env, SIYUAN_URL: backend, SIYUAN_TOKEN: token },
      stdio: ['ignore', 'ignore', 'pipe']
    })
    child.stderr.pipe(process.stderr)
    child.on('error', () => {
      initializing = false
      json(500, { error: 'Could not start initialization.' })
    })
    child.on('close', (code) => {
      initializing = false
      if (code === 0) {
        startError = ''
        process.stdout.write('CHERRY_SPACE_READY\n')
      }
      if (!res.writableEnded)
        json(
          code === 0 ? 200 : 500,
          code === 0 ? { ok: true } : { error: 'Initialization failed; check the backend and API token.' }
        )
    })
    return
  }
  return json(404, { error: 'Not found' })
})
server.listen(port, '127.0.0.1', () => process.stdout.write(`Memories UI: http://127.0.0.1:${port}/\n`))
