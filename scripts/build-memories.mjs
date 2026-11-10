import { spawn } from 'node:child_process'
import { cp, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = `${root}/packages/cherry-memories-server`
const output = `${root}/out/memories`
await mkdir(output, { recursive: true })
await Promise.all([
  cp(`${source}/src`, `${output}/src`, { recursive: true }),
  cp(`${source}/package.json`, `${output}/package.json`),
  cp(`${source}/package-lock.json`, `${output}/package-lock.json`)
])
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const child = spawn(
  npm,
  ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false'],
  { cwd: output, stdio: 'inherit' }
)
const code = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', resolve)
})
if (code !== 0) throw new Error(`npm ci failed with exit code ${code}`)
