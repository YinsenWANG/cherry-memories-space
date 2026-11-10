import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'
import { redactSecretText } from '@shared/utils/redaction'

const logger = loggerService.withContext('SpaceService')
const legacyLocalUrl = 'http://127.0.0.1:16807/mcp'

@Injectable('SpaceService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['McpCatalogService'])
export class SpaceService extends BaseService {
  private child: ChildProcess | undefined

  protected async onReady(): Promise<void> {
    const server = mcpServerService.findByIdOrName(BuiltinMcpServerNames.sharedMemories)
    if (!server || server.installSource !== 'builtin') return
    const mode = Object.entries(server.headers ?? {}).find(([key]) => key.toLowerCase() === 'x-cherry-space-mode')?.[1]
    if (mode === 'remote' || (!mode && server.baseUrl && server.baseUrl !== legacyLocalUrl)) return

    const token = randomBytes(32).toString('base64url')
    const child = spawn(
      application.getPath('app.exe_file'),
      [
        application.getPath('feature.space.launcher_file'),
        '--data-dir',
        application.getPath('feature.space.data'),
        '--endpoint-file',
        application.getPath('feature.space.endpoint_file'),
        '--port',
        '0'
      ],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          CHERRY_MEMORIES_LOCAL_TOKEN: token,
          CHERRY_MEMORIES_ALLOWED_ORIGINS: 'null,http://localhost:5173,http://127.0.0.1:5173'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    this.child = child
    let output = ''
    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString()
      const lines = output.split('\n')
      output = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('CHERRY_MEMORIES_READY ')) continue
        try {
          const { url } = JSON.parse(line.slice('CHERRY_MEMORIES_READY '.length)) as { url: string }
          void this.connectSpace(url, token)
        } catch (error) {
          logger.error('Invalid Space server startup message', error as Error)
        }
      }
    })
    child.stderr?.on('data', (data: Buffer) => logger.warn(redactSecretText(data.toString())))
    child.once('error', (error) => logger.error('Space server failed', error))
    child.once('exit', (code) => {
      if (this.child === child) this.child = undefined
      if (code && this.isReady) logger.warn('Space server exited', { code })
    })
  }

  protected async onStop(): Promise<void> {
    this.child?.kill('SIGTERM')
    this.child = undefined
  }

  private async connectSpace(url: string, token: string): Promise<void> {
    try {
      const server = mcpServerService.findByIdOrName(BuiltinMcpServerNames.sharedMemories)
      if (!server || server.installSource !== 'builtin') return
      const mode = Object.entries(server.headers ?? {}).find(
        ([key]) => key.toLowerCase() === 'x-cherry-space-mode'
      )?.[1]
      if (mode === 'remote') return
      const headers = Object.fromEntries(
        Object.entries(server.headers ?? {}).filter(
          ([key]) => !['authorization', 'x-cherry-space-mode'].includes(key.toLowerCase())
        )
      )
      mcpServerService.update(server.id, {
        baseUrl: `${url}/mcp`,
        headers: { ...headers, Authorization: `Bearer ${token}`, 'X-Cherry-Space-Mode': 'local' }
      })
      if (server.isActive) await application.get('McpRuntimeService').restartServer(server.id)
    } catch (error) {
      logger.error('Could not connect the Space MCP server', error as Error)
    }
  }
}
