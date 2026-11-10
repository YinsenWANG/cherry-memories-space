#!/usr/bin/env node
// Exercises two independent MCP connections; this does not simulate an LLM.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const token =
  process.env.SIYUAN_TOKEN ||
  (process.env.SIYUAN_WORKSPACE &&
    JSON.parse(await readFile(join(process.env.SIYUAN_WORKSPACE, 'conf/conf.json'), 'utf8')).api.token)
if (!token) throw new Error('Set SIYUAN_WORKSPACE or SIYUAN_TOKEN')
const base = process.env.SIYUAN_URL || 'http://127.0.0.1:16807'
async function connect(name) {
  const client = new Client({ name, version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
  )
  return client
}
async function db(client, args) {
  const result = await client.callTool({ name: 'database', arguments: args })
  if (result.isError) throw new Error(JSON.stringify(result.content))
  return result.structuredContent.data
}
const a = await connect('smoke-agent-a')
let b, id, row
const marker = randomUUID().slice(0, 8)
const original = `品牌主色不用紫色 ${marker}`
const corrected = `品牌主色改为蓝色，不用紫色 ${marker}`
try {
  const found = await db(a, { action: 'search', keyword: 'Memories' })
  const matches = found.results.filter(
    (item) => item.avName === 'Memories' && item.hPath === 'Cherry-Studio-Memories/Memories'
  )
  assert.equal(matches.length, 1)
  id = matches[0].avID
  const schema = await db(a, { action: 'keys', id })
  const keys = Object.fromEntries(schema.keys.map((item) => [item.name, item.id]))
  row = (await db(a, { action: 'item_add', id, content: original, detached: true })).itemID
  await db(a, {
    action: 'item_update',
    id,
    itemID: row,
    keyID: keys['Source Agent'],
    value: { type: 'text', text: { content: 'smoke-agent-a' } }
  })
  console.log('A wrote:', original)
  await a.close()
  b = await connect('smoke-agent-b-new-session')
  let result = await db(b, { action: 'render', id, query: marker })
  assert.equal(result.view.rows.length, 1)
  assert.equal(result.view.rows[0].cells[0].value.block.content, original)
  assert.equal(
    result.view.rows[0].cells.find((cell) => cell.value.keyID === keys['Source Agent']).value.text.content,
    'smoke-agent-a'
  )
  console.log('B recalled A and its source')
  await db(b, {
    action: 'item_update',
    id,
    itemID: row,
    keyID: keys.Memory,
    value: { type: 'block', block: { content: corrected } }
  })
  result = await db(b, { action: 'render', id, query: marker })
  assert.equal(result.view.rows[0].cells[0].value.block.content, corrected)
  console.log('B corrected:', corrected)
  await db(b, { action: 'item_remove', id, itemIDs: [row] })
  row = undefined
  result = await db(b, { action: 'render', id, query: marker })
  assert.equal(result.view.rowCount, 0)
  console.log('B removed the row; matching rows:', result.view.rowCount)
} finally {
  if (row && b) await db(b, { action: 'item_remove', id, itemIDs: [row] })
  if (b) await b.close()
  else await a.close()
}
