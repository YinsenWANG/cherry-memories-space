#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { startServer } from './server.mjs'
import { startStdio } from './stdio.mjs'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '3000' },
    host: { type: 'string', default: '127.0.0.1' },
    'data-dir': { type: 'string' },
    stdio: { type: 'boolean' },
    url: { type: 'string' },
    'token-file': { type: 'string' },
    'endpoint-file': { type: 'string' }
  }
})

try {
  if (values.stdio) {
    if ((!values.url && !values['endpoint-file']) || !values['token-file'])
      throw new Error('stdio requires --url or --endpoint-file, and --token-file')
    const url = values.url ?? JSON.parse(readFileSync(values['endpoint-file'], 'utf8')).url
    await startStdio(url, readFileSync(values['token-file'], 'utf8').trim())
  } else {
    if (!values['data-dir']) throw new Error('--data-dir is required')
    const endpointFile =
      values['endpoint-file'] ??
      (process.env.CHERRY_MEMORIES_LOCAL_TOKEN ? join(values['data-dir'], 'server-endpoint.json') : undefined)
    const server = await startServer({
      dataDir: values['data-dir'],
      port: Number(values.port),
      host: values.host,
      localToken: process.env.CHERRY_MEMORIES_LOCAL_TOKEN,
      secret: process.env.BETTER_AUTH_SECRET,
      publicUrl: process.env.BETTER_AUTH_URL,
      localLauncher: endpointFile ? { command: process.execPath, entry: process.argv[1], endpointFile } : undefined,
      allowedOrigins: (process.env.CHERRY_MEMORIES_ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    })
    try {
      if (process.env.CHERRY_MEMORIES_LOCAL_TOKEN) {
        const tokenFile = join(values['data-dir'], 'server-token')
        writeFileSync(tokenFile, process.env.CHERRY_MEMORIES_LOCAL_TOKEN, { mode: 0o600 })
        chmodSync(tokenFile, 0o600)
      }
      if (endpointFile) {
        writeFileSync(endpointFile, JSON.stringify({ url: server.url }), { mode: 0o600 })
        chmodSync(endpointFile, 0o600)
      }
    } catch (error) {
      await server.close()
      throw error
    }
    process.stdout.write(`CHERRY_MEMORIES_READY ${JSON.stringify({ url: server.url })}\n`)
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => {
        void server.close().then(() => process.exit(0))
      })
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
