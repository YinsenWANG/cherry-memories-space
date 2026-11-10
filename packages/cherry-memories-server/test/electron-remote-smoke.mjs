import assert from 'node:assert/strict'

import { chromium, expect } from '@playwright/test'

const [cdpUrl, targetUrl, serverUrl] = process.argv.slice(2)
if (!cdpUrl || !targetUrl || !serverUrl)
  throw new Error('Usage: node electron-remote-smoke.mjs <cdp-url> <exact-target-url> <server-url>')
const suffix = Date.now().toString()
const password = 'strong-test-password-123'
const accounts = ['alice', 'bob'].map((name) => ({
  name: `${name}-${suffix}`,
  email: `${name}-${suffix}@example.test`,
  title: `${name} private preference ${suffix}`
}))

for (const account of accounts) {
  const signup = await fetch(`${serverUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { Origin: serverUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: account.name, email: account.email, password })
  })
  assert.equal(signup.status, 200)
  const { token } = await signup.json()
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const { current } = await (await fetch(`${serverUrl}/api/spaces`, { headers })).json()
  const base = `${serverUrl}/api/spaces/${current.id}/memories`
  const { revision } = await (await fetch(base, { headers })).json()
  const created = await fetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      revision,
      memory: { Title: account.title, Body: `visible to ${account.name}`, Type: 'Preference', SourceAgent: 'ui-test' }
    })
  })
  assert.equal(created.status, 201)
}

const browser = await chromium.connectOverCDP(cdpUrl)
const page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((candidate) => candidate.url() === targetUrl)
if (!page) throw new Error('The tracked Cherry main window was not found')
if (await page.getByText('稍后设置', { exact: true }).isVisible())
  await page.getByText('稍后设置', { exact: true }).click()

async function settings() {
  await page.getByRole('button', { name: '用户', exact: true }).click()
  await page.getByText('设置', { exact: true }).last().click()
  await page.getByText('空间', { exact: true }).first().click()
}

async function signIn(account) {
  if ((await page.locator('#space-mode').innerText()) !== '远程') {
    await page.locator('#space-mode').click()
    await page.getByRole('option', { name: '远程' }).click()
  }
  await page.locator('#space-url').fill(serverUrl)
  await page.locator('#space-email').fill(account.email)
  await page.locator('#space-password').fill(password)
  const response = page.waitForResponse((result) => result.url().endsWith('/api/session/sign-in'))
  await page.getByRole('button', { name: '登录', exact: true }).click()
  assert.equal((await response).status(), 200)
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeEnabled()
}

async function signOut() {
  const response = page.waitForResponse((result) => result.url().endsWith('/api/session/sign-out'))
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  assert.equal((await response).status(), 200)
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeDisabled()
}

async function space() {
  await page.getByRole('button', { name: '返回', exact: true }).click()
  const table = page.getByRole('button', { name: '表格', exact: true }).first()
  if (!(await table.isVisible())) {
    await page.getByRole('button', { name: '启动台' }).last().click()
    await page.getByText('空间', { exact: true }).first().click()
  }
  await table.click()
}

await settings()
await signIn(accounts[0])
await space()
await expect(page.locator(`input[value="${accounts[0].title}"]`)).toBeVisible()
await expect(page.locator(`input[value="${accounts[1].title}"]`)).toHaveCount(0)
await settings()
await signOut()
await signIn(accounts[1])
await space()
await expect(page.locator(`input[value="${accounts[1].title}"]`)).toBeVisible()
await expect(page.locator(`input[value="${accounts[0].title}"]`)).toHaveCount(0)
await settings()
await signOut()
await page.getByRole('button', { name: '返回', exact: true }).click()
await expect(page.locator(`input[value="${accounts[1].title}"]`)).toHaveCount(0)
process.stdout.write('remote UI: alice and bob sign-in, isolated Space rows, and sign-out passed\n')
process.exit(0)
