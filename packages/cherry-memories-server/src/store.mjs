import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { createEidosFile, openEidosFile } from '@eidos.space/eidos-file/node-sqlite'
import * as z from 'zod'

const guide = readFileSync(fileURLToPath(new URL('./guide.md', import.meta.url)), 'utf8')
const memoryTypes = ['Profile', 'Preference', 'Work', 'People', 'Notes']
const memoryFields = ['Title', 'Body', 'Type', 'SourceAgent', 'Status', 'SourceURL', 'ConfirmedAt']
const memoryInput = z
  .object({
    Title: z.string().trim().min(1).max(500),
    Body: z.string().trim().min(1).max(100000),
    Type: z.enum(memoryTypes),
    SourceAgent: z.string().trim().min(1).max(200),
    Status: z.enum(['active', 'superseded', 'forgotten']).default('active'),
    SourceURL: z.string().max(2000).nullable().optional(),
    ConfirmedAt: z.string().max(100).nullable().optional()
  })
  .strict()

export class SpaceError extends Error {
  constructor(code, message, status = 400, details) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

function expectedRevision(value) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value ?? ''))) {
    throw new SpaceError('invalid-revision', 'A non-negative revision is required.')
  }
  return BigInt(value)
}

function parseMemory(value) {
  const result = memoryInput.safeParse(value)
  if (!result.success) {
    throw new SpaceError(
      'invalid-memory',
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    )
  }
  return result.data
}

function normalizedTitle(value) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function similarTitle(left, right) {
  const a = normalizedTitle(left)
  const b = normalizedTitle(right)
  if (!a || !b) return false
  if (a === b) return true
  if (Math.min(a.length, b.length) < 4) return false
  const counts = new Map()
  for (let i = 0; i < a.length - 1; i++) counts.set(a.slice(i, i + 2), (counts.get(a.slice(i, i + 2)) ?? 0) + 1)
  let overlap = 0
  for (let i = 0; i < b.length - 1; i++) {
    const pair = b.slice(i, i + 2)
    const available = counts.get(pair) ?? 0
    if (available) {
      overlap++
      counts.set(pair, available - 1)
    }
  }
  return (2 * overlap) / (a.length + b.length - 2) >= 0.8
}

function cleanRevision(value) {
  return String(value)
}

export class SpaceStore {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    this.dataDir = dataDir
    this.lockPath = join(dataDir, 'server.lock')
    try {
      this.lock = openSync(this.lockPath, 'wx', 0o600)
      writeFileSync(this.lock, `${process.pid}\n`)
    } catch (error) {
      if (error.code === 'EEXIST')
        throw new SpaceError('data-dir-locked', 'Another server may own this data directory.', 409)
      throw error
    }
    try {
      this.db = new DatabaseSync(join(dataDir, 'spaces.sqlite'))
      this.db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS current_spaces (owner_id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id));
        CREATE TABLE IF NOT EXISTS pages (
          id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id), parent_id TEXT REFERENCES pages(id),
          title TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
          deleted INTEGER NOT NULL DEFAULT 0, builtin TEXT, UNIQUE(space_id, builtin)
        );
      `)
      this.grids = new Map()
      this.pending = Promise.resolve()
    } catch (error) {
      closeSync(this.lock)
      unlinkSync(this.lockPath)
      throw error
    }
  }

  write(operation) {
    const result = this.pending.then(operation)
    this.pending = result.catch(() => {})
    return result
  }

  close() {
    for (const grid of this.grids.values()) grid.close()
    this.db.close()
    closeSync(this.lock)
    unlinkSync(this.lockPath)
  }

  requireSpace(owner, spaceId) {
    const space = this.db.prepare('SELECT id, name FROM spaces WHERE id = ? AND owner_id = ?').get(spaceId, owner)
    if (!space) throw new SpaceError('not-found', 'Space not found.', 404)
    return space
  }

  grid(spaceId) {
    let grid = this.grids.get(spaceId)
    if (grid) return grid
    const spaceDir = join(this.dataDir, 'spaces', spaceId)
    mkdirSync(spaceDir, { recursive: true, mode: 0o700 })
    const file = join(spaceDir, 'tables.eidos')
    grid = existsSync(file) ? openEidosFile(file) : createEidosFile(file, { title: 'Space tables' })
    this.grids.set(spaceId, grid)
    return grid
  }

  async initialize(owner) {
    return this.write(() => {
      let current = this.db.prepare('SELECT space_id FROM current_spaces WHERE owner_id = ?').get(owner)
      if (!current) {
        const id = randomUUID()
        this.db.prepare('INSERT INTO spaces VALUES (?, ?, ?)').run(id, owner, 'My Space')
        this.db.prepare('INSERT INTO current_spaces VALUES (?, ?)').run(owner, id)
        current = { space_id: id }
      }
      const space = this.requireSpace(owner, current.space_id)
      this.initializeSpace(space.id)
      return space
    })
  }

  initializeSpace(spaceId) {
    const grid = this.grid(spaceId)
    if (!grid.listTables().some((table) => table.name === 'Memories')) {
      grid.createTable({ name: 'Memories', fields: memoryFields.map((name) => ({ name, type: 'text' })) })
    }
    this.db
      .prepare('INSERT OR IGNORE INTO pages (id, space_id, title, body, builtin) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), spaceId, 'Agent Operating Guide', guide, 'agent-guide')
    const skillsDir = join(this.dataDir, 'spaces', spaceId, 'skills', 'cherry-studio-memories')
    mkdirSync(skillsDir, { recursive: true, mode: 0o700 })
    try {
      writeFileSync(
        join(skillsDir, 'SKILL.md'),
        `---\nname: cherry-studio-memories\ndescription: Use the shared Space memory tools.\n---\n\n${guide}`,
        { flag: 'wx', mode: 0o600 }
      )
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }

  spaces(owner) {
    return this.db.prepare('SELECT id, name FROM spaces WHERE owner_id = ? ORDER BY name, id').all(owner)
  }

  current(owner) {
    const row = this.db.prepare('SELECT space_id FROM current_spaces WHERE owner_id = ?').get(owner)
    if (!row) throw new SpaceError('not-found', 'No current Space.', 404)
    return this.requireSpace(owner, row.space_id)
  }

  async setCurrent(owner, spaceId) {
    return this.write(() => {
      const space = this.requireSpace(owner, spaceId)
      this.db
        .prepare(
          'INSERT INTO current_spaces VALUES (?, ?) ON CONFLICT(owner_id) DO UPDATE SET space_id = excluded.space_id'
        )
        .run(owner, spaceId)
      this.initializeSpace(spaceId)
      return space
    })
  }

  async createSpace(owner, name) {
    const title = z.string().trim().min(1).max(200).parse(name)
    return this.write(() => {
      const id = randomUUID()
      this.db.prepare('INSERT INTO spaces VALUES (?, ?, ?)').run(id, owner, title)
      this.initializeSpace(id)
      return { id, name: title }
    })
  }

  pages(owner, spaceId, query = '') {
    this.requireSpace(owner, spaceId)
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`
    return this.db
      .prepare(
        "SELECT id, parent_id AS parentId, title, revision FROM pages WHERE space_id = ? AND deleted = 0 AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\') ORDER BY title, id"
      )
      .all(spaceId, pattern, pattern)
  }

  page(owner, spaceId, pageId) {
    this.requireSpace(owner, spaceId)
    const row = this.db
      .prepare(
        'SELECT id, parent_id AS parentId, title, body, revision FROM pages WHERE space_id = ? AND id = ? AND deleted = 0'
      )
      .get(spaceId, pageId)
    if (!row) throw new SpaceError('not-found', 'Page not found.', 404)
    return row
  }

  async createPage(owner, spaceId, input) {
    const parsed = z
      .object({
        title: z.string().trim().min(1).max(500),
        body: z.string().max(1000000).default(''),
        parentId: z.string().nullable().optional()
      })
      .strict()
      .parse(input)
    return this.write(() => {
      this.requireSpace(owner, spaceId)
      if (parsed.parentId) this.page(owner, spaceId, parsed.parentId)
      const id = randomUUID()
      this.db
        .prepare('INSERT INTO pages (id, space_id, parent_id, title, body) VALUES (?, ?, ?, ?, ?)')
        .run(id, spaceId, parsed.parentId ?? null, parsed.title, parsed.body)
      return this.page(owner, spaceId, id)
    })
  }

  async updatePage(owner, spaceId, pageId, input) {
    const parsed = z
      .object({
        title: z.string().trim().min(1).max(500),
        body: z.string().max(1000000),
        revision: z.union([z.string(), z.number()])
      })
      .strict()
      .parse(input)
    const revision = expectedRevision(parsed.revision)
    return this.write(() => {
      this.page(owner, spaceId, pageId)
      const result = this.db
        .prepare(
          'UPDATE pages SET title = ?, body = ?, revision = revision + 1 WHERE space_id = ? AND id = ? AND deleted = 0 AND revision = ?'
        )
        .run(parsed.title, parsed.body, spaceId, pageId, revision)
      if (!result.changes) throw new SpaceError('stale-revision', 'Page changed; read it again before writing.', 409)
      return this.page(owner, spaceId, pageId)
    })
  }

  async deletePage(owner, spaceId, pageId, revision) {
    const expected = expectedRevision(revision)
    return this.write(() => {
      this.page(owner, spaceId, pageId)
      const result = this.db
        .prepare(
          'UPDATE pages SET deleted = 1, revision = revision + 1 WHERE space_id = ? AND id = ? AND deleted = 0 AND revision = ?'
        )
        .run(spaceId, pageId, expected)
      if (!result.changes) throw new SpaceError('stale-revision', 'Page changed; read it again before deleting.', 409)
      return { deleted: true }
    })
  }

  tables(owner, spaceId) {
    this.requireSpace(owner, spaceId)
    const grid = this.grid(spaceId)
    return { revision: cleanRevision(grid.info().revision), tables: grid.listTables() }
  }

  table(owner, spaceId, tableId) {
    this.requireSpace(owner, spaceId)
    const grid = this.grid(spaceId)
    const table = grid.listTables().find((item) => item.id === tableId)
    if (!table) throw new SpaceError('not-found', 'Table not found.', 404)
    return {
      revision: cleanRevision(grid.info().revision),
      table,
      fields: grid.listFields(tableId),
      views: grid.listViews(tableId)
    }
  }

  rows(owner, spaceId, tableId, options = {}) {
    const schema = this.table(owner, spaceId, tableId)
    const grid = this.grid(spaceId)
    const query = {}
    if (options.filterField) {
      const field = schema.fields.find((item) => item.id === options.filterField || item.name === options.filterField)
      if (!field) throw new SpaceError('invalid-field', 'Filter field not found.')
      query.filter = {
        type: 'group',
        conjunction: 'and',
        children: [{ type: 'rule', field: field.id, operator: 'contains', value: String(options.filterValue ?? '') }]
      }
    }
    if (options.sortField) {
      const field = schema.fields.find((item) => item.id === options.sortField || item.name === options.sortField)
      if (!field) throw new SpaceError('invalid-field', 'Sort field not found.')
      query.sorts = [{ field: field.id, direction: options.sortDirection === 'desc' ? 'desc' : 'asc' }]
    }
    const offset = Math.max(0, Number(options.offset) || 0)
    const limit = Math.min(200, Math.max(1, Number(options.limit) || 100))
    const page = grid.getRowPage(tableId, offset, limit, query)
    return { revision: cleanRevision(grid.info().revision), ...page }
  }

  memoryTable(owner, spaceId) {
    this.requireSpace(owner, spaceId)
    const grid = this.grid(spaceId)
    const table = grid.listTables().find((item) => item.name === 'Memories')
    if (!table) throw new SpaceError('not-found', 'Memories table not found.', 404)
    return { grid, table }
  }

  allMemoryRows(grid, tableId) {
    const rows = []
    for (let offset = 0; ; offset += 200) {
      const page = grid.getRowPage(tableId, offset, 200)
      rows.push(...page.rows)
      if (rows.length >= page.total || page.rows.length === 0) return rows
    }
  }

  searchMemory(owner, spaceId, query = '') {
    const { grid, table } = this.memoryTable(owner, spaceId)
    const needle = query.normalize('NFKC').toLowerCase()
    const rows = this.allMemoryRows(grid, table.id).filter(
      (row) => row.Status === 'active' && `${row.Title}\n${row.Body}`.normalize('NFKC').toLowerCase().includes(needle)
    )
    return { revision: cleanRevision(grid.info().revision), rows }
  }

  checkDuplicate(grid, tableId, memory, excludeId) {
    if (memory.Status !== 'active') return
    const duplicate = this.allMemoryRows(grid, tableId).find(
      (row) =>
        row._id !== excludeId &&
        row.Status === 'active' &&
        row.Type === memory.Type &&
        similarTitle(row.Title, memory.Title)
    )
    if (duplicate)
      throw new SpaceError(
        'already-exists',
        'A similar active memory already exists. Review it and update it instead.',
        409,
        { existing: duplicate, revision: cleanRevision(grid.info().revision) }
      )
  }

  async createMemory(owner, spaceId, input, revision) {
    const memory = parseMemory(input)
    const expected = expectedRevision(revision)
    return this.write(() => {
      const { grid, table } = this.memoryTable(owner, spaceId)
      if (BigInt(grid.info().revision) !== expected)
        throw new SpaceError('stale-revision', 'Table changed; read it again before writing.', 409)
      this.checkDuplicate(grid, table.id, memory)
      const result = grid.mutateRows({ tableId: table.id, expectedRevision: expected, insert: [{ fields: memory }] })
      return { revision: cleanRevision(result.revision), row: grid.getRow(table.id, result.rows[0].id) }
    })
  }

  async updateMemory(owner, spaceId, rowId, changes, revision, forget = false) {
    const expected = expectedRevision(revision)
    return this.write(() => {
      const { grid, table } = this.memoryTable(owner, spaceId)
      if (BigInt(grid.info().revision) !== expected)
        throw new SpaceError('stale-revision', 'Table changed; read it again before writing.', 409)
      const previous = grid.getRow(table.id, rowId)
      if (!previous) throw new SpaceError('not-found', 'Memory not found.', 404)
      const original = Object.fromEntries(memoryFields.map((key) => [key, previous[key]]))
      const memory =
        forget || changes?.Status === 'forgotten'
          ? { ...original, Title: 'Forgotten', Body: '', SourceURL: null, Status: 'forgotten' }
          : parseMemory({ ...original, ...changes })
      this.checkDuplicate(grid, table.id, memory, rowId)
      const result = grid.mutateRows({
        tableId: table.id,
        expectedRevision: expected,
        update: [{ id: rowId, fields: memory }]
      })
      return { revision: cleanRevision(result.revision), row: grid.getRow(table.id, rowId) }
    })
  }

  async mutateRow(owner, spaceId, tableId, operation, input, revision) {
    const schema = this.table(owner, spaceId, tableId)
    if (schema.table.name === 'Memories') {
      if (operation === 'insert') return this.createMemory(owner, spaceId, input.fields, revision)
      if (operation === 'update') return this.updateMemory(owner, spaceId, input.id, input.fields, revision)
      if (operation === 'delete') return this.updateMemory(owner, spaceId, input.id, {}, revision, true)
    }
    const expected = expectedRevision(revision)
    return this.write(() => {
      this.table(owner, spaceId, tableId)
      const grid = this.grid(spaceId)
      if (BigInt(grid.info().revision) !== expected)
        throw new SpaceError('stale-revision', 'Table changed; read it again before writing.', 409)
      const mutation =
        operation === 'insert'
          ? { insert: [{ fields: input.fields }] }
          : operation === 'update'
            ? { update: [{ id: input.id, fields: input.fields }] }
            : { delete: [input.id] }
      const result = grid.mutateRows({ tableId, expectedRevision: expected, ...mutation })
      return {
        revision: cleanRevision(result.revision),
        row: result.rows[0] ? grid.getRow(tableId, result.rows[0].id) : null,
        deleted: result.deleted
      }
    })
  }
}
