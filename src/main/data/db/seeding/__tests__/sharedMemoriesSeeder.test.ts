import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { CherryAssistantSeeder } from '@data/db/seeding/seeders/cherryAssistantSeeder'
import { SharedMemoriesSeeder } from '@data/db/seeding/seeders/sharedMemoriesSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { agentService } from '@data/services/AgentService'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

describe('SharedMemoriesSeeder', () => {
  const dbh = setupTestDatabase()

  it('installs and binds the enabled server on a fresh installation', () => {
    new SeedRunner(dbh.db).runAll([new CherryAssistantSeeder(), new SharedMemoriesSeeder()])

    const assistant = agentService.findBuiltinAgentByRoleTx(dbh.db, 'assistant')!
    const server = dbh.db
      .select()
      .from(mcpServerTable)
      .where(eq(mcpServerTable.name, BuiltinMcpServerNames.sharedMemories))
      .get()!
    expect(server).toMatchObject({ type: 'streamableHttp', isActive: true, isTrusted: true, installSource: 'builtin' })
    expect(
      dbh.db.select().from(agentMcpServerTable).where(eq(agentMcpServerTable.agentId, assistant.id)).all()
    ).toEqual([expect.objectContaining({ mcpServerId: server.id })])
  })

  it('preserves a user-disabled server and removed binding on subsequent starts', () => {
    const seeders = [new CherryAssistantSeeder(), new SharedMemoriesSeeder()]
    new SeedRunner(dbh.db).runAll(seeders)
    const server = dbh.db
      .select()
      .from(mcpServerTable)
      .where(eq(mcpServerTable.name, BuiltinMcpServerNames.sharedMemories))
      .get()!
    dbh.db
      .update(mcpServerTable)
      .set({ isActive: false, baseUrl: 'https://example.com/mcp' })
      .where(eq(mcpServerTable.id, server.id))
      .run()
    dbh.db.delete(agentMcpServerTable).where(eq(agentMcpServerTable.mcpServerId, server.id)).run()

    new SeedRunner(dbh.db).runAll(seeders)

    expect(dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, server.id)).get()).toMatchObject({
      isActive: false,
      baseUrl: 'https://example.com/mcp'
    })
    expect(
      dbh.db.select().from(agentMcpServerTable).where(eq(agentMcpServerTable.mcpServerId, server.id)).all()
    ).toEqual([])
  })

  it('upgrades a same-name non-builtin server so the local backend can start', () => {
    new SeedRunner(dbh.db).runAll([new CherryAssistantSeeder()])
    dbh.db
      .insert(mcpServerTable)
      .values({
        name: BuiltinMcpServerNames.sharedMemories,
        type: 'streamableHttp',
        baseUrl: 'http://127.0.0.1:16807/mcp',
        installSource: 'manual',
        isActive: true,
        isTrusted: false,
        shouldConfig: true
      })
      .run()

    new SeedRunner(dbh.db).runAll([new CherryAssistantSeeder(), new SharedMemoriesSeeder()])

    const server = dbh.db
      .select()
      .from(mcpServerTable)
      .where(eq(mcpServerTable.name, BuiltinMcpServerNames.sharedMemories))
      .get()!
    // SpaceService 只认 installSource === 'builtin'，否则会早退、本地后端不会启动
    expect(server.installSource).toBe('builtin')
    expect(server.isTrusted).toBe(true)
    expect(dbh.db.select().from(mcpServerTable).all()).toHaveLength(1)
  })
})
