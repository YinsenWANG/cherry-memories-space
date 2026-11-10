#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.env.MEMORIES_HOME || join(homedir(), '.cherry-studio-memories')
const workspace = process.env.SIYUAN_WORKSPACE || join(root, 'workspace')
const dir = dirname(fileURLToPath(import.meta.url))
const backend = process.env.SIYUAN_URL || 'http://127.0.0.1:16807'
let kernel, web, initializer
let stopping = false

function stop() {
  if (stopping) return
  stopping = true
  initializer?.kill('SIGTERM')
  web?.kill('SIGTERM')
  kernel?.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

function startWeb(reason = '') {
  web = spawn(process.execPath, [join(dir, 'server.mjs')], {
    env: { ...process.env, SIYUAN_WORKSPACE: workspace, SIYUAN_URL: backend, SIYUAN_START_ERROR: reason },
    stdio: 'inherit'
  })
  web.on('exit', (status) => {
    if (!stopping) {
      stop()
      process.exitCode = status || 0
    }
  })
  web.on('error', (error) => {
    process.stderr.write(`Space UI could not start: ${error.message}\n`)
    stop()
    process.exitCode = 1
  })
}

async function initialize(token) {
  initializer = spawn(process.execPath, [join(dir, 'bootstrap.mjs')], {
    env: { ...process.env, SIYUAN_URL: backend, SIYUAN_TOKEN: token },
    stdio: ['ignore', 'ignore', 'inherit']
  })
  return new Promise((resolve) => {
    initializer.once('error', () => resolve(false))
    initializer.once('exit', (code) => resolve(code === 0))
  })
}

async function main() {
  if (backend !== 'http://127.0.0.1:16807') {
    const initialized = process.env.SIYUAN_TOKEN && (await initialize(process.env.SIYUAN_TOKEN))
    startWeb(initialized ? '' : 'initialization_failed')
    if (initialized) process.stdout.write('CHERRY_SPACE_READY\n')
    return
  }

  const binaryName = process.platform === 'win32' ? 'SiYuan-Kernel.exe' : 'SiYuan-Kernel'
  const candidates = [
    process.env.SIYUAN_KERNEL,
    process.platform === 'darwin' ? '/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel' : null,
    ...(process.env.PATH || '').split(delimiter).flatMap((entry) => [join(entry, binaryName), join(entry, 'siyuan')])
  ].filter(Boolean)
  let binary
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      binary = candidate
      break
    } catch {
      /* Try the next installation. */
    }
  }
  if (!binary) {
    process.stderr.write('SiYuan kernel not found. Install it from https://github.com/siyuan-note/siyuan/releases.\n')
    startWeb('missing_kernel')
    return
  }

  try {
    await fetch(`${backend}/api/system/version`, { method: 'POST', signal: AbortSignal.timeout(1500) })
    startWeb('port_in_use')
    return
  } catch {
    /* No server answered at the local kernel port. */
  }
  await mkdir(root, { recursive: true, mode: 0o700 })
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  await mkdir(join(root, 'home'), { recursive: true, mode: 0o700 })
  const codeFile = join(root, 'access-code')
  let code
  try {
    code = (await readFile(codeFile, 'utf8')).trim()
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    code = randomBytes(24).toString('base64url')
    await writeFile(codeFile, code, { mode: 0o600, flag: 'wx' })
  }
  kernel = spawn(
    binary,
    ['--home-dir', join(root, 'home'), '--workspace', workspace, 'serve', '--port', '16807', '--accessAuthCode', code],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  )
  kernel.on('exit', (status) => {
    stop()
    process.exitCode = status || 0
  })
  kernel.on('error', (error) => {
    process.stderr.write(`SiYuan could not start: ${error.message}\n`)
    stop()
    process.exitCode = 1
  })
  let token
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    try {
      const config = JSON.parse(await readFile(join(workspace, 'conf', 'conf.json'), 'utf8'))
      const response = await fetch(`${backend}/api/system/version`, {
        method: 'POST',
        headers: { Authorization: `Token ${config.api.token}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(1000)
      })
      if (response.ok && (await response.json()).code === 0) {
        token = config.api.token
        break
      }
    } catch {
      /* Kernel startup is asynchronous. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!token || stopping) {
    if (!stopping) startWeb('startup_failed')
    return
  }
  const initialized = await initialize(token)
  if (stopping) return
  startWeb(initialized ? '' : 'initialization_failed')
  if (initialized) process.stdout.write('CHERRY_SPACE_READY\n')
  process.stdout.write(`SiYuan access code is stored in ${codeFile}.\n`)
}

main().catch((error) => {
  process.stderr.write(`Space could not start: ${error.message}\n`)
  stop()
  process.exitCode = 1
})
