import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { startServer } from '../src/server.mjs'
import { SpaceStore } from '../src/store.mjs'

const localToken = 'test-local-token-012345678901234567890123456789'
const memory = {
  Title: 'Preferred response length',
  Body: 'Use short answers',
  Type: 'Preference',
  SourceAgent: 'test-agent'
}

async function fixture(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cherry-space-test-'))
  const server = await startServer({ dataDir: dir, ...options })
  return {
    dir,
    server,
    async close() {
      await server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

async function remoteCliFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cherry-space-remote-'))
  const env = {
    ...process.env,
    BETTER_AUTH_SECRET: 'test-secret-0123456789012345678901234567890',
    CHERRY_MEMORIES_ALLOWED_ORIGINS: 'null'
  }
  delete env.CHERRY_MEMORIES_LOCAL_TOKEN
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), '--data-dir', dir, '--port', '0'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let stderr = ''
  child.stderr.on('data', (data) => {
    stderr += data.toString()
  })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const url = await new Promise((resolve, reject) => {
    let output = ''
    child.stdout.on('data', (data) => {
      output += data.toString()
      const line = output.split('\n').find((value) => value.startsWith('CHERRY_MEMORIES_READY '))
      if (line) resolve(JSON.parse(line.slice('CHERRY_MEMORIES_READY '.length)).url)
    })
    child.once('error', reject)
    child.once('exit', () => reject(new Error(`Server exited before ready: ${stderr}`)))
  })
  return {
    server: { url },
    async close() {
      child.kill('SIGTERM')
      await exited
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

async function request(server, token, path, method = 'GET', body) {
  const response = await fetch(server.url + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  return { status: response.status, body: await response.json() }
}

async function mcpClient(server, token) {
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', server.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
  )
  return client
}

void test('REST validates, deduplicates, detects stale writes and forgets; pages and table share the service', async () => {
  const f = await fixture({
    localToken,
    localLauncher: { command: '/test/electron', entry: '/test/cli.mjs', endpointFile: '/test/endpoint.json' }
  })
  try {
    const setup = await (await fetch(`${f.server.url}/setup`)).text()
    assert.match(setup, /"--endpoint-file"/)
    assert.match(setup, /"ELECTRON_RUN_AS_NODE": "1"/)
    assert.equal(setup.includes(localToken), false)
    const { current } = (await request(f.server, localToken, '/api/spaces')).body
    const base = `/api/spaces/${current.id}`
    const initial = (await request(f.server, localToken, `${base}/memories`)).body
    const missing = await request(f.server, localToken, `${base}/memories`, 'POST', {
      revision: initial.revision,
      memory: { Title: 'Missing fields', Body: 'body' }
    })
    assert.equal(missing.status, 400)
    assert.match(missing.body.message, /Type/)
    assert.match(missing.body.message, /SourceAgent/)
    const created = await request(f.server, localToken, `${base}/memories`, 'POST', {
      revision: initial.revision,
      memory
    })
    assert.equal(created.status, 201)
    const duplicate = await request(f.server, localToken, `${base}/memories`, 'POST', {
      revision: created.body.revision,
      memory: { ...memory, Title: 'Preferred response lengths' }
    })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.body.error, 'already-exists')
    assert.equal(duplicate.body.existing._id, created.body.row._id)
    const stale = await request(f.server, localToken, `${base}/memories/${created.body.row._id}`, 'PATCH', {
      revision: initial.revision,
      changes: { Body: 'Lost update' }
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error, 'stale-revision')
    const changed = await request(f.server, localToken, `${base}/memories/${created.body.row._id}`, 'PATCH', {
      revision: created.body.revision,
      changes: { Body: 'Use detailed answers' }
    })
    assert.equal(changed.body.row.Body, 'Use detailed answers')
    assert.equal((await request(f.server, localToken, `${base}/memories?query=detailed`)).body.rows.length, 1)
    const table = (await request(f.server, localToken, `${base}/tables`)).body.tables[0]
    assert.equal(
      (await request(f.server, localToken, `${base}/tables/${table.id}`)).body.fields.some(
        (field) => field.name === 'Type'
      ),
      true
    )
    assert.equal(
      (
        await request(
          f.server,
          localToken,
          `${base}/tables/${table.id}/rows?filterField=Type&filterValue=Preference&sortField=Title`
        )
      ).body.rows.length,
      1
    )
    const bypass = await request(f.server, localToken, `${base}/tables/${table.id}/rows`, 'POST', {
      revision: changed.body.revision,
      fields: { Title: 'Bypass' }
    })
    assert.equal(bypass.body.error, 'invalid-memory')
    const forgotten = await request(f.server, localToken, `${base}/memories/${created.body.row._id}`, 'DELETE', {
      revision: changed.body.revision
    })
    assert.equal(forgotten.body.row.Status, 'forgotten')
    assert.equal(forgotten.body.row.Body, '')
    assert.equal((await request(f.server, localToken, `${base}/memories`)).body.rows.length, 0)
    const rowsPath = `${base}/tables/${table.id}/rows`
    const last = await request(f.server, localToken, rowsPath, 'POST', {
      revision: forgotten.body.revision,
      fields: { ...memory, Title: 'Zulu', Type: 'Notes' }
    })
    const first = await request(f.server, localToken, rowsPath, 'POST', {
      revision: last.body.revision,
      fields: { ...memory, Title: 'Alpha', Type: 'Notes' }
    })
    assert.equal(last.status, 201)
    assert.equal(first.status, 201)
    const ascending = await request(
      f.server,
      localToken,
      `${rowsPath}?filterField=Type&filterValue=Notes&sortField=Title&sortDirection=asc`
    )
    const descending = await request(
      f.server,
      localToken,
      `${rowsPath}?filterField=Type&filterValue=Notes&sortField=Title&sortDirection=desc`
    )
    assert.deepEqual(
      ascending.body.rows.map((row) => row.Title),
      ['Alpha', 'Zulu']
    )
    assert.deepEqual(
      descending.body.rows.map((row) => row.Title),
      ['Zulu', 'Alpha']
    )
    const page = await request(f.server, localToken, `${base}/pages`, 'POST', { title: 'Project', body: 'Old notes' })
    const updated = await request(f.server, localToken, `${base}/pages/${page.body.id}`, 'PUT', {
      title: 'Project',
      body: 'New notes',
      revision: page.body.revision
    })
    assert.equal(updated.body.body, 'New notes')
    assert.equal((await request(f.server, localToken, `${base}/pages?query=New`)).body.pages.length, 1)
    assert.equal(
      (await request(f.server, localToken, `${base}/pages/${page.body.id}`, 'DELETE', { revision: page.body.revision }))
        .body.error,
      'stale-revision'
    )
    assert.equal(
      (
        await request(f.server, localToken, `${base}/pages/${page.body.id}`, 'DELETE', {
          revision: updated.body.revision
        })
      ).body.deleted,
      true
    )
    assert.equal((await request(f.server, localToken, `${base}/pages/${page.body.id}`)).status, 404)
  } finally {
    await f.close()
  }
})

void test('MCP HTTP and stdio clients share search, create, update, forget and revision checks', async () => {
  const f = await fixture({ localToken })
  const client = await mcpClient(f.server, localToken)
  let stdio
  try {
    const call = (name, args = {}) => client.callTool({ name, arguments: args })
    const before = (await call('memory_search', { query: '' })).structuredContent
    const created = (await call('memory_create', { ...memory, revision: before.revision })).structuredContent
    assert.equal(created.row.Body, memory.Body)
    const invalid = await call('memory_create', { Title: 'invalid', Body: 'body', revision: created.revision })
    assert.equal(invalid.isError, true)
    const duplicate = await call('memory_create', { ...memory, revision: created.revision })
    assert.equal(duplicate.structuredContent.error, 'already-exists')
    const stale = await call('memory_update', {
      rowId: created.row._id,
      revision: before.revision,
      changes: { Body: 'wrong' }
    })
    assert.equal(stale.structuredContent.error, 'stale-revision')
    const tokenFile = join(f.dir, 'test-token')
    const endpointFile = join(f.dir, 'test-endpoint.json')
    writeFileSync(tokenFile, localToken, { mode: 0o600 })
    writeFileSync(endpointFile, JSON.stringify({ url: f.server.url }), { mode: 0o600 })
    stdio = new Client({ name: 'stdio-test', version: '1' })
    await stdio.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          fileURLToPath(new URL('../src/cli.mjs', import.meta.url)),
          '--stdio',
          '--endpoint-file',
          endpointFile,
          '--token-file',
          tokenFile
        ]
      })
    )
    const found = (await stdio.callTool({ name: 'memory_search', arguments: { query: 'short' } })).structuredContent
    assert.equal(found.rows[0]._id, created.row._id)
    const updated = (
      await stdio.callTool({
        name: 'memory_update',
        arguments: { rowId: created.row._id, revision: found.revision, changes: { Body: 'Use detailed answers' } }
      })
    ).structuredContent
    assert.equal(updated.row.Body, 'Use detailed answers')
    const deleted = (await call('memory_forget', { rowId: created.row._id, revision: updated.revision }))
      .structuredContent
    assert.equal(deleted.row.Status, 'forgotten')
    assert.equal((await call('memory_search', { query: '' })).structuredContent.rows.length, 0)
  } finally {
    if (stdio) await stdio.close()
    await client.close()
    await f.close()
  }
})

void test('initialization preserves the guide and skill, and creates one Memories table', async () => {
  const f = await fixture({ localToken })
  try {
    const space = f.server.store.current('local')
    const guide = f.server.store.pages('local', space.id)[0]
    await f.server.store.updatePage('local', space.id, guide.id, {
      title: guide.title,
      body: 'User-edited guide',
      revision: guide.revision
    })
    const skill = join(f.dir, 'spaces', space.id, 'skills', 'cherry-studio-memories', 'SKILL.md')
    writeFileSync(skill, 'User-edited skill')
    await f.server.store.initialize('local')
    await f.server.store.initialize('local')
    assert.equal(f.server.store.pages('local', space.id).length, 1)
    assert.equal(f.server.store.page('local', space.id, guide.id).body, 'User-edited guide')
    assert.equal(readFileSync(skill, 'utf8'), 'User-edited skill')
    assert.equal(f.server.store.tables('local', space.id).tables.filter((item) => item.name === 'Memories').length, 1)
  } finally {
    await f.close()
  }
})

void test('concurrent writers cannot overwrite the same revision or open a second writer', async () => {
  const f = await fixture({ localToken })
  try {
    const { current } = (await request(f.server, localToken, '/api/spaces')).body
    const base = `/api/spaces/${current.id}/memories`
    const revision = (await request(f.server, localToken, base)).body.revision
    const writes = await Promise.all(
      ['First', 'Second', 'Third'].map((title) =>
        request(f.server, localToken, base, 'POST', { revision, memory: { ...memory, Title: title } })
      )
    )
    assert.equal(writes.filter((item) => item.status === 201).length, 1)
    assert.equal(writes.filter((item) => item.body.error === 'stale-revision').length, 2)
    assert.equal((await request(f.server, localToken, base)).body.rows.length, 1)
    assert.throws(() => new SpaceStore(f.dir), /Another server may own/)
  } finally {
    await f.close()
  }
})

void test('two accounts have isolated spaces over REST and MCP', async () => {
  const f = await remoteCliFixture()
  const clients = []
  try {
    async function signUp(name) {
      const response = await fetch(`${f.server.url}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: f.server.url },
        body: JSON.stringify({ name, email: `${name}@example.test`, password: 'strong-test-password-123' })
      })
      assert.equal(response.status, 200)
      return (await response.json()).token
    }
    const alice = await signUp('alice')
    const bob = await signUp('bob')
    const aliceSpace = (await request(f.server, alice, '/api/spaces')).body.current
    const bobSpace = (await request(f.server, bob, '/api/spaces')).body.current
    assert.notEqual(aliceSpace.id, bobSpace.id)
    const a = `/api/spaces/${aliceSpace.id}`
    const page = await request(f.server, alice, `${a}/pages`, 'POST', { title: 'Private', body: 'Alice only' })
    assert.equal(page.status, 201)
    assert.equal((await request(f.server, bob, `${a}/pages`)).status, 404)
    assert.equal((await request(f.server, bob, `${a}/pages/${page.body.id}`)).status, 404)
    const bobClient = await mcpClient(f.server, bob)
    clients.push(bobClient)
    const denied = await bobClient.callTool({
      name: 'page_read',
      arguments: { spaceId: aliceSpace.id, pageId: page.body.id }
    })
    assert.equal(denied.structuredContent.error, 'not-found')
    assert.equal((await request(f.server, 'invalid', '/api/spaces')).status, 401)
    const signIn = async (name, password) =>
      fetch(`${f.server.url}/api/session/sign-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'null' },
        body: JSON.stringify({ email: `${name}@example.test`, password })
      })
    assert.equal((await signIn('alice', 'incorrect-password')).status, 401)
    const signedIn = await signIn('alice', 'strong-test-password-123')
    assert.equal(signedIn.status, 200)
    const newToken = (await signedIn.json()).token
    assert.equal((await request(f.server, newToken, '/api/spaces')).body.current.id, aliceSpace.id)
    const bobSignIn = await signIn('bob', 'strong-test-password-123')
    assert.equal(bobSignIn.status, 200)
    const bobToken = (await bobSignIn.json()).token
    assert.equal((await request(f.server, bobToken, '/api/spaces')).body.current.id, bobSpace.id)
    assert.equal((await request(f.server, bobToken, `${a}/pages`)).status, 404)
    assert.equal((await request(f.server, newToken, '/api/session/sign-out', 'POST')).status, 200)
    assert.equal((await request(f.server, newToken, '/api/spaces')).status, 401)
  } finally {
    for (const client of clients) await client.close()
    await f.close()
  }
})
