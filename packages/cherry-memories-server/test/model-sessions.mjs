import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { startServer } from '../src/server.mjs'

const outputDir = process.argv[2]
if (!outputDir) throw new Error('Provide an output directory for the model transcripts')
await mkdir(outputDir, { recursive: true })
const dir = await mkdtemp(join(tmpdir(), 'cherry-model-sessions-'))
const token = randomBytes(32).toString('hex')
const tokenFile = join(dir, 'token')
await writeFile(tokenFile, token, { mode: 0o600 })
const server = await startServer({ dataDir: join(dir, 'data'), localToken: token })
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url))
const config = `mcp_servers.memories={command=${JSON.stringify(process.execPath)},args=[${[cli, '--stdio', '--url', server.url, '--token-file', tokenFile].map(JSON.stringify).join(',')}],default_tools_approval_mode="approve"}`

async function run(name, prompt) {
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--json',
    '-m',
    'gpt-6.1-terra',
    '-s',
    'read-only',
    '-c',
    config,
    prompt
  ]
  const child = spawn('codex', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout = []
  const stderr = []
  child.stdout.on('data', (data) => stdout.push(data))
  child.stderr.on('data', (data) => stderr.push(data))
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  await writeFile(join(outputDir, `${name}.jsonl`), Buffer.concat(stdout))
  await writeFile(join(outputDir, `${name}.stderr`), Buffer.concat(stderr))
  process.stdout.write(`${name}: exit ${code}; transcript ${join(outputDir, `${name}.jsonl`)}\n`)
  return code
}

try {
  const a = await run(
    'session-a',
    'This is an isolated synthetic test. My durable preference is: when listing travel ideas, use a short bold heading for each idea. Save this preference in the shared Memories system. Search first; set Type to Preference and SourceAgent to session-a. Do not access local files or run shell commands.'
  )
  if (a !== 0) throw new Error(`Session A exited ${a}`)
  const b = await run(
    'session-b',
    'This is a new session for an isolated synthetic test. First search shared Memories for my travel-ideas formatting preference and answer in English with two fictional travel ideas using the remembered preference. Then I correct the preference: use plain headings with no bold. Update the existing memory accordingly. Finally, I ask you to forget this test preference; forget it. Perform these steps in order and do not access local files or run shell commands.'
  )
  if (b !== 0) throw new Error(`Session B exited ${b}`)
} finally {
  await server.close()
}
