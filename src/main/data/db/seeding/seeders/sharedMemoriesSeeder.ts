import { eq } from 'drizzle-orm'

import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { PRESET_MCP_SERVERS } from '@shared/data/presets/mcpServers'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const logger = loggerService.withContext('SharedMemoriesSeeder')

const preset = PRESET_MCP_SERVERS.find((server) => server.name === BuiltinMcpServerNames.sharedMemories)!

/**
 * 安装内置「共享记忆」MCP 服务器并绑定到内置 assistant。
 *
 * 为什么不能是 bootstrap-only：从官方 2.1.7 升级上来的库没有这条记录，而
 * `SpaceService.onReady()` 的 `if (!server || server.installSource !== 'builtin') return`
 * 会直接早退 —— 本地后端永远不会被拉起，Space 页面永久白屏「连接中」且不报错。
 *
 * 两个额外加固：
 * - 建记录不再依赖 assistant 是否存在（找不到就先建服务器、跳过绑定），否则助手被软删除的库
 *   连记录都建不出来，而 journal 仍记为已执行，形成永久断点。
 * - 同名但非 builtin 的记录（用户手动加过）升级为 builtin，否则 SpaceService 同样早退。
 */
export class SharedMemoriesSeeder implements ISeeder {
  readonly name = 'sharedMemories'
  readonly description = 'Install the builtin shared-memories MCP server (also upgrades existing profiles)'
  readonly executionPolicy = 'run-on-change' as const
  // seedRev 让「老库已有同版本 journal、但没有记录」的情况也重跑一次
  readonly version = hashObject({ preset, seedRev: 2 })

  run(db: DbType): void {
    db.transaction((tx) => {
      const assistant = agentService.findBuiltinAgentByRoleTx(tx, 'assistant')
      const existing = tx.select().from(mcpServerTable).where(eq(mcpServerTable.name, preset.name)).get()

      if (existing) {
        // 已有记录：只在「同名但不是内置」时升级为内置（否则 SpaceService 会早退、后端不启动）。
        // 用户自己把它停用或解绑的选择必须保留 —— 已有测试明确要求这一点，不能自动重新启用/绑定。
        if (existing.installSource !== 'builtin') {
          logger.warn(
            `Found a non-builtin MCP server named ${preset.name} (installSource=${existing.installSource}); upgrading it to builtin so the local Space backend can start`
          )
          tx.update(mcpServerTable)
            .set({
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
            .where(eq(mcpServerTable.id, existing.id))
            .run()
        }
        return
      }

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

      if (assistant) {
        tx.insert(agentMcpServerTable).values({ agentId: assistant.id, mcpServerId: server.id }).run()
      } else {
        // 助手缺失也先把服务器建出来，避免「记录建不出来 + journal 已记」的永久断点
        logger.warn('No builtin assistant found; shared-memories server created but not bound to an agent')
      }
    })
  }
}
