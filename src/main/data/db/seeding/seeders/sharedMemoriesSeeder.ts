import { eq } from 'drizzle-orm'

import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { agentService } from '@data/services/AgentService'
import { PRESET_MCP_SERVERS } from '@shared/data/presets/mcpServers'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const preset = PRESET_MCP_SERVERS.find((server) => server.name === BuiltinMcpServerNames.sharedMemories)!

export class SharedMemoriesSeeder implements ISeeder {
  readonly name = 'sharedMemories'
  readonly description = 'Install shared memories for the builtin assistant on fresh installations'
  // 升级用户的老库里没有这条内置 MCP 记录，bootstrap-only 会让 SpaceService 早退、
  // 本地后端永远不会被拉起（Space 页面白屏「连接中」）。改为 run-on-change：run() 本身幂等。
  readonly executionPolicy = 'run-on-change' as const
  readonly version = hashObject(preset)

  run(db: DbType): void {
    db.transaction((tx) => {
      const assistant = agentService.findBuiltinAgentByRoleTx(tx, 'assistant')
      if (!assistant || tx.select().from(mcpServerTable).where(eq(mcpServerTable.name, preset.name)).get()) return

      const [server] = tx
        .insert(mcpServerTable)
        .values({
          name: preset.name,
          type: preset.type,
          baseUrl: preset.baseUrl,
          headers: preset.headers,
          provider: preset.provider,
          reference: preset.reference,
          installSource: 'builtin',
          isActive: true,
          isTrusted: true,
          shouldConfig: false
        })
        .returning()
        .all()
      tx.insert(agentMcpServerTable).values({ agentId: assistant.id, mcpServerId: server.id }).run()
    })
  }
}
