import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [bin, entry] = process.argv.slice(2)
if (!bin) throw new Error('Provide the server executable, optionally followed by a CLI script')
const dir = mkdtempSync(join(tmpdir(), 'cherry-package-smoke-'))
const token = 'package-smoke-token-0123456789012345678901234567'
const child = spawn(resolve(bin), [...(entry ? [resolve(entry)] : []), '--data-dir', dir, '--port', '0'], {
  env: { ...process.env, CHERRY_MEMORIES_LOCAL_TOKEN: token },
  stdio: ['ignore', 'pipe', 'inherit']
})
const exited = new Promise((resolve) => child.once('close', resolve))
try {
  const url = await new Promise((resolve, reject) => {
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
      const match = output.match(/CHERRY_MEMORIES_READY (\{[^\n]+\})/)
      if (match) resolve(JSON.parse(match[1]).url)
    })
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Server exited before ready: ${code}`)))
  })
  const response = await fetch(`${url}/api/spaces`, { headers: { Authorization: `Bearer ${token}` } })
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.spaces.length, 1)
  const base = `${url}/api/spaces/${result.current.id}/memories`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const { revision } = await (await fetch(base, { headers })).json()
  const created = await fetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      revision,
      memory: { Title: 'Runtime smoke', Body: 'Persisted', Type: 'Notes', SourceAgent: 'runtime-smoke' }
    })
  })
  assert.equal(created.status, 201)
  const search = await (await fetch(`${base}?query=Persisted`, { headers })).json()
  assert.equal(search.rows.length, 1)
  process.stdout.write(
    `server CLI: spaces=${result.spaces.length}, write=${created.status}, search=${search.rows.length}\n`
  )
} finally {
  child.kill('SIGTERM')
  await exited
  rmSync(dir, { recursive: true, force: true })
}
