import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { chromium, expect } from '@playwright/test'

const [cdpUrl, targetUrl, dataDir] = process.argv.slice(2)
if (!cdpUrl || !targetUrl || !dataDir)
  throw new Error('Usage: node electron-smoke.mjs <cdp-url> <exact-target-url> <space-data-dir>')
const browser = await chromium.connectOverCDP(cdpUrl)
const page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((candidate) => candidate.url() === targetUrl)
if (!page) throw new Error('The tracked Cherry main window was not found')
if (await page.getByText('稍后设置', { exact: true }).isVisible())
  await page.getByText('稍后设置', { exact: true }).click()
if (!(await page.getByRole('button', { name: '新建笔记' }).first().isVisible())) {
  await page.getByRole('button', { name: '启动台' }).last().click()
  await page.getByText('空间', { exact: true }).first().click()
}
await page.getByRole('button', { name: '新建笔记' }).first().waitFor({ timeout: 30000 })
const suffix = Date.now().toString()
const pageTitle = `Smoke page ${suffix}`
const rowTitle = `Smoke row ${suffix}`
const created = page.waitForResponse(
  (response) => response.url().endsWith('/pages') && response.request().method() === 'POST'
)
await page.getByRole('button', { name: '新建笔记' }).first().click()
await created
await expect(page.getByRole('button', { name: '新建笔记' }).first()).toBeEnabled()
await expect(page.getByLabel('标题', { exact: true })).toHaveValue('新建笔记')
await page.getByLabel('标题', { exact: true }).fill(pageTitle)
await page.locator('[contenteditable=true]').first().fill('Persisted from the packaged editor')
await page.getByRole('button', { name: '保存', exact: true }).click()
await page.getByRole('button', { name: '表格', exact: true }).first().click()
await page.getByPlaceholder('标题').fill(rowTitle)
await page.getByPlaceholder('内容').fill('Before editing')
await page.getByRole('button', { name: '添加', exact: true }).last().click()
const row = page.getByRole('row').filter({ has: page.locator(`input[value="${rowTitle}"]`) })
await row.getByLabel('Body', { exact: true }).fill('After editing')
await row.getByLabel('Body', { exact: true }).blur()
await page.getByPlaceholder('筛选').fill('Notes')
await expect(row).toBeVisible()

const token = readFileSync(join(dataDir, 'server-token'), 'utf8').trim()
const { url } = JSON.parse(readFileSync(join(dataDir, 'server-endpoint.json'), 'utf8'))
const headers = { Authorization: `Bearer ${token}` }
const client = new Client({ name: 'electron-smoke', version: '1' })
await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', url), { requestInit: { headers } }))
try {
  await expect
    .poll(async () => {
      const result = await client.callTool({ name: 'memory_search', arguments: { query: rowTitle } })
      return result.structuredContent.rows[0]?.Body
    })
    .toBe('After editing')
  const { current } = await (await fetch(`${url}/api/spaces`, { headers })).json()
  const { pages } = await (
    await fetch(`${url}/api/spaces/${current.id}/pages?query=${encodeURIComponent(pageTitle)}`, { headers })
  ).json()
  assert.equal(pages.length, 1)
  const saved = await (await fetch(`${url}/api/spaces/${current.id}/pages/${pages[0].id}`, { headers })).json()
  assert.equal(saved.body, 'Persisted from the packaged editor')
  const setup = await (await fetch(`${url}/setup`)).text()
  const config = JSON.parse(setup.slice(setup.indexOf('{\n'), setup.lastIndexOf('}') + 1))
  const stdio = new Client({ name: 'electron-stdio-smoke', version: '1' })
  await stdio.connect(
    new StdioClientTransport({ ...config, env: { ...process.env, PATH: '/usr/bin:/bin', ...config.env } })
  )
  try {
    const result = await stdio.callTool({ name: 'memory_search', arguments: { query: rowTitle } })
    assert.equal(result.structuredContent.rows[0].Body, 'After editing')
  } finally {
    await stdio.close()
  }
  process.stdout.write(
    'page saved; row created and edited; Type filter applied; external HTTP and setup stdio MCP returned the edit\n'
  )
} finally {
  await client.close()
}
process.exit(0)
