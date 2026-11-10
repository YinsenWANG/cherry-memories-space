import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'

import { SpaceError } from './store.mjs'

const revision = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .describe('Revision from the most recent table or memory read')
const spaceId = z.string().optional().describe('Space ID; omit for the current Space')
const fields = {
  Title: z.string().min(1),
  Body: z.string().min(1),
  Type: z.enum(['Profile', 'Preference', 'Work', 'People', 'Notes']),
  SourceAgent: z.string().min(1),
  Status: z.enum(['active', 'superseded', 'forgotten']).optional(),
  SourceURL: z.string().nullable().optional(),
  ConfirmedAt: z.string().nullable().optional()
}

function response(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
}

function failure(error) {
  const value =
    error instanceof SpaceError
      ? { error: error.code, message: error.message, ...error.details }
      : { error: 'operation-failed', message: error.message }
  return { ...response(value), isError: true }
}

export function createMcp(store, owner) {
  const server = new McpServer({ name: 'cherry-studio-memories', version: '0.1.0' })
  const current = (id) => id ?? store.current(owner).id
  const register = (name, description, inputSchema, run) => {
    server.registerTool(name, { description, inputSchema }, async (args) => {
      try {
        return response(await run(args))
      } catch (error) {
        return failure(error)
      }
    })
  }
  register('space_list', 'List your Spaces and identify the current Space.', {}, () => ({
    spaces: store.spaces(owner),
    current: store.current(owner)
  }))
  register('space_create', 'Create a Space.', { name: z.string().min(1) }, ({ name }) => store.createSpace(owner, name))
  register('space_set_current', 'Set your current Space.', { spaceId: z.string() }, ({ spaceId }) =>
    store.setCurrent(owner, spaceId)
  )
  register(
    'page_list',
    'List or search pages by title and text.',
    { spaceId, query: z.string().optional() },
    ({ spaceId, query }) => ({ pages: store.pages(owner, current(spaceId), query) })
  )
  register('page_read', 'Read a page and its revision.', { spaceId, pageId: z.string() }, ({ spaceId, pageId }) =>
    store.page(owner, current(spaceId), pageId)
  )
  register(
    'page_create',
    'Create a page.',
    { spaceId, title: z.string().min(1), body: z.string(), parentId: z.string().optional() },
    ({ spaceId, ...input }) => store.createPage(owner, current(spaceId), input)
  )
  register(
    'page_update',
    'Update a page with the revision from page_read.',
    { spaceId, pageId: z.string(), title: z.string().min(1), body: z.string(), revision },
    ({ spaceId, pageId, ...input }) => store.updatePage(owner, current(spaceId), pageId, input)
  )
  register(
    'page_delete',
    'Soft-delete a page with the revision from page_read.',
    { spaceId, pageId: z.string(), revision },
    ({ spaceId, pageId, revision }) => store.deletePage(owner, current(spaceId), pageId, revision)
  )
  register('table_list', 'List tables and the current file revision.', { spaceId }, ({ spaceId }) =>
    store.tables(owner, current(spaceId))
  )
  register('table_schema', 'Read table fields and views.', { spaceId, tableId: z.string() }, ({ spaceId, tableId }) =>
    store.table(owner, current(spaceId), tableId)
  )
  register(
    'table_rows',
    'Read rows with optional field filtering and sorting.',
    {
      spaceId,
      tableId: z.string(),
      filterField: z.string().optional(),
      filterValue: z.string().optional(),
      sortField: z.string().optional(),
      sortDirection: z.enum(['asc', 'desc']).optional(),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(200).optional()
    },
    ({ spaceId, tableId, ...options }) => store.rows(owner, current(spaceId), tableId, options)
  )
  register(
    'table_row_create',
    'Create a table row. Memories rows require all memory fields.',
    { spaceId, tableId: z.string(), fields: z.record(z.string(), z.unknown()), revision },
    ({ spaceId, tableId, fields, revision }) =>
      store.mutateRow(owner, current(spaceId), tableId, 'insert', { fields }, revision)
  )
  register(
    'table_row_update',
    'Update a table row.',
    { spaceId, tableId: z.string(), rowId: z.string(), fields: z.record(z.string(), z.unknown()), revision },
    ({ spaceId, tableId, rowId, fields, revision }) =>
      store.mutateRow(owner, current(spaceId), tableId, 'update', { id: rowId, fields }, revision)
  )
  register(
    'table_row_delete',
    'Delete a table row. Memories are forgotten instead.',
    { spaceId, tableId: z.string(), rowId: z.string(), revision },
    ({ spaceId, tableId, rowId, revision }) =>
      store.mutateRow(owner, current(spaceId), tableId, 'delete', { id: rowId }, revision)
  )
  register(
    'memory_search',
    'Search active memories before answering or saving. Returns the revision required for a write.',
    { spaceId, query: z.string().default('') },
    ({ spaceId, query }) => store.searchMemory(owner, current(spaceId), query)
  )
  register(
    'memory_create',
    'Save a durable memory after searching. Type and SourceAgent are required; similar active titles are rejected.',
    { spaceId, revision, ...fields },
    ({ spaceId, revision, ...memory }) => store.createMemory(owner, current(spaceId), memory, revision)
  )
  register(
    'memory_update',
    'Update an existing memory, using the revision returned by the latest search.',
    { spaceId, rowId: z.string(), revision, changes: z.object(fields).partial().strict() },
    ({ spaceId, rowId, revision, changes }) => store.updateMemory(owner, current(spaceId), rowId, changes, revision)
  )
  register(
    'memory_forget',
    'Forget a memory by clearing its title, body, and source URL and marking it forgotten.',
    { spaceId, rowId: z.string(), revision },
    ({ spaceId, rowId, revision }) => store.updateMemory(owner, current(spaceId), rowId, {}, revision, true)
  )
  return server
}
