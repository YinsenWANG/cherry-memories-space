import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  DataTable,
  type DataTableProps,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import { SpaceApi } from './spaceApi'

const RichEditor = lazy(() => import('@renderer/components/RichEditor/RichEditor'))
const memoryTypes = ['Profile', 'Preference', 'Work', 'People', 'Notes'] as const

type Space = { id: string; name: string }
type Page = { id: string; parentId: string | null; title: string; body: string; revision: number }
type PageItem = Omit<Page, 'body'>
type Table = { id: string; name: string }
type Field = { id: string; name: string; isHidden: boolean; writable: boolean }
type Row = { _id: string; [key: string]: string | number | boolean | null }
type Rows = { revision: string; rows: Row[] }

export default function SpacePage() {
  const { t } = useTranslation()
  const { mcpServers, refetch: reloadMcpServers } = useMcpServers()
  const server = mcpServers.find((item) => item.name === BuiltinMcpServerNames.sharedMemories)
  const token = Object.entries(server?.headers ?? {})
    .find(([key]) => key.toLowerCase() === 'authorization')?.[1]
    ?.replace(/^Bearer\s+/i, '')
  const baseUrl = server?.baseUrl?.replace(/\/mcp\/?$/, '').replace(/\/$/, '')
  const api = useMemo(() => (baseUrl && token ? new SpaceApi(baseUrl, token) : undefined), [baseUrl, token])
  // 本地后端就绪后会把 Bearer token 与端口回写进 MCP 记录。页面如果只在挂载时读一次，
  // 就会永久停在「连接中」（没有任何报错）。这里做有限重试，最多 30 秒。
  useEffect(() => {
    if (api) return
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      void reloadMcpServers?.()
      if (tries >= 15) clearInterval(timer)
    }, 2000)
    return () => clearInterval(timer)
  }, [api, reloadMcpServers])
  const [spaces, setSpaces] = useState<Space[]>([])
  const [space, setSpace] = useState<Space>()
  const [pages, setPages] = useState<PageItem[]>([])
  const [tables, setTables] = useState<Table[]>([])
  const [page, setPage] = useState<Page>()
  const [savedPage, setSavedPage] = useState<Page>()
  const [editorReset, setEditorReset] = useState(0)
  const [tab, setTab] = useState<'pages' | 'table' | 'memories'>('pages')
  const [tableId, setTableId] = useState('')
  const [fields, setFields] = useState<Field[]>([])
  const [rows, setRows] = useState<Rows>({ revision: '0', rows: [] })
  const [filter, setFilter] = useState('')
  const [filterField, setFilterField] = useState('Type')
  const [sortField, setSortField] = useState('Title')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newType, setNewType] = useState<string>('Notes')
  const [spaceName, setSpaceName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = !!page && !!savedPage && (page.title !== savedPage.title || page.body !== savedPage.body)

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true)
      setError('')
      try {
        await action()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('common.save_failed'))
      } finally {
        setBusy(false)
      }
    },
    [t]
  )

  const loadSpace = useCallback(
    async (selected: Space) => {
      if (!api) return
      const root = `/api/spaces/${selected.id}`
      const [pageList, tableList] = await Promise.all([
        api.request<{ pages: PageItem[] }>(`${root}/pages`),
        api.request<{ tables: Table[] }>(`${root}/tables`)
      ])
      setSpace(selected)
      setPages(pageList.pages)
      setTables(tableList.tables)
      const firstPage = pageList.pages.find((item) => item.title === 'Agent Operating Guide') ?? pageList.pages[0]
      const opened = firstPage ? await api.request<Page>(`${root}/pages/${firstPage.id}`) : undefined
      setPage(opened)
      setSavedPage(opened)
      setTableId(tableList.tables[0]?.id ?? '')
    },
    [api]
  )

  useEffect(() => {
    if (!api) return
    let active = true
    setSpace(undefined)
    setPages([])
    setRows({ revision: '0', rows: [] })
    void api
      .request<{ spaces: Space[]; current: Space }>('/api/spaces')
      .then(async (result) => {
        if (!active) return
        setSpaces(result.spaces)
        await loadSpace(result.current)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : t('common.save_failed'))
      })
    return () => {
      active = false
    }
  }, [api, loadSpace, t])

  const loadRows = useCallback(async () => {
    if (!api || !space || !tableId) return
    const root = `/api/spaces/${space.id}/tables/${tableId}`
    const query = new URLSearchParams({ sortField, sortDirection })
    if (filter) {
      query.set('filterField', filterField)
      query.set('filterValue', filter)
    }
    const [schema, data] = await Promise.all([
      api.request<{ fields: Field[] }>(root),
      api.request<Rows>(`${root}/rows?${query}`)
    ])
    setFields(schema.fields.filter((field) => !field.isHidden && field.writable))
    setRows(data)
  }, [api, space, tableId, filter, filterField, sortField, sortDirection])

  useEffect(() => {
    if (tab !== 'pages') void run(loadRows)
  }, [tab, loadRows, run])

  const openPage = (id: string) =>
    void run(async () => {
      if (!api || !space) return
      const result = await api.request<Page>(`/api/spaces/${space.id}/pages/${id}`)
      setPage(result)
      setSavedPage(result)
    })
  const savePage = () =>
    void run(async () => {
      if (!api || !space || !page) return
      const result = await api.request<Page>(`/api/spaces/${space.id}/pages/${page.id}`, 'PUT', {
        title: page.title,
        body: page.body,
        revision: page.revision
      })
      setPage(result)
      setSavedPage(result)
      setPages((previous) =>
        previous.map((item) =>
          item.id === result.id ? { ...item, title: result.title, revision: result.revision } : item
        )
      )
    })
  const createPage = () =>
    void run(async () => {
      if (!api || !space) return
      const root = `/api/spaces/${space.id}`
      const result = await api.request<Page>(`${root}/pages`, 'POST', {
        title: t('notes.new_note'),
        body: '',
        parentId: null
      })
      setPages((await api.request<{ pages: PageItem[] }>(`${root}/pages`)).pages)
      setPage(result)
      setSavedPage(result)
    })
  const deletePage = () =>
    void run(async () => {
      if (!api || !space || !page) return
      const root = `/api/spaces/${space.id}`
      await api.request(`${root}/pages/${page.id}`, 'DELETE', { revision: page.revision })
      setPages((await api.request<{ pages: PageItem[] }>(`${root}/pages`)).pages)
      setPage(undefined)
      setSavedPage(undefined)
    })
  const updateCell = (row: Row, field: string, value: string) =>
    void run(async () => {
      if (!api || !space || !tableId || String(row[field] ?? '') === value) return
      await api.request(`/api/spaces/${space.id}/tables/${tableId}/rows/${row._id}`, 'PATCH', {
        fields: { [field]: value },
        revision: rows.revision
      })
      await loadRows()
    })
  const columns: DataTableProps<Row>['columns'] = fields.map((field) => ({
    id: field.id,
    header: field.name,
    cell: ({ row }) => (
      <Input
        aria-label={field.name}
        key={`${row.original._id}-${field.id}-${rows.revision}`}
        defaultValue={String(row.original[field.name] ?? '')}
        onBlur={(event) => updateCell(row.original, field.name, event.currentTarget.value)}
      />
    )
  }))
  const createMemory = () =>
    void run(async () => {
      if (!api || !space || !tableId) return
      await api.request(`/api/spaces/${space.id}/tables/${tableId}/rows`, 'POST', {
        revision: rows.revision,
        fields: { Title: newTitle, Body: newBody, Type: newType, SourceAgent: 'Cherry Studio' }
      })
      setNewTitle('')
      setNewBody('')
      await loadRows()
    })
  const tree = (parentId: string | null, depth = 0): React.ReactNode =>
    pages
      .filter(
        (item) =>
          item.parentId === parentId ||
          (parentId === null && item.parentId && !pages.some((parent) => parent.id === item.parentId))
      )
      .map((item) => (
        <div key={item.id}>
          <Button
            variant={page?.id === item.id ? 'secondary' : 'ghost'}
            className="w-full justify-start"
            style={{ paddingLeft: 12 + depth * 16 }}
            disabled={dirty || busy}
            onClick={() => openPage(item.id)}>
            {item.title}
          </Button>
          {tree(item.id, depth + 1)}
        </div>
      ))

  if (!api) return <div className="p-6 text-muted-foreground">{t('settings.mcp.runtimeStatus.connecting')}</div>
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        {space && (
          <Select
            value={space.id}
            disabled={dirty || busy}
            onValueChange={(id) =>
              void run(async () => {
                const next = await api.request<Space>('/api/spaces/current', 'PUT', { spaceId: id })
                await loadSpace(next)
              })
            }>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {spaces.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          className="w-40"
          value={spaceName}
          placeholder={t('settings.space.title')}
          onChange={(event) => setSpaceName(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={!spaceName.trim() || busy}
          onClick={() =>
            void run(async () => {
              const created = await api.request<Space>('/api/spaces', 'POST', { name: spaceName })
              setSpaces((items) => [...items, created])
              setSpaceName('')
            })
          }>
          {t('common.add')}
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            void run(async () =>
              navigator.clipboard.writeText(t('settings.space.setupPrompt', { url: `${baseUrl}/setup` }))
            )
          }>
          {t('common.copy')}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t('settings.space.setupPrompt', { url: `${baseUrl}/setup` })}
        </span>
      </div>
      {error && (
        <p role="alert" className="border-b p-3 text-error">
          {error}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-auto border-r p-2">
          <Button
            variant={tab === 'pages' ? 'secondary' : 'ghost'}
            className="w-full justify-start"
            disabled={dirty}
            onClick={() => setTab('pages')}>
            {t('notes.title')}
          </Button>
          <Button
            variant={tab === 'table' ? 'secondary' : 'ghost'}
            className="w-full justify-start"
            disabled={dirty}
            onClick={() => setTab('table')}>
            {t('richEditor.commands.table.title')}
          </Button>
          <Button
            variant={tab === 'memories' ? 'secondary' : 'ghost'}
            className="w-full justify-start"
            disabled={dirty}
            onClick={() => setTab('memories')}>
            {t('agent.memory.title')}
          </Button>
          {tab === 'pages' && (
            <>
              <Button variant="outline" className="my-2 w-full" disabled={dirty || busy} onClick={createPage}>
                {t('notes.new_note')}
              </Button>
              {tree(null)}
            </>
          )}
        </aside>
        <main className="min-w-0 flex-1 overflow-auto p-4">
          {tab === 'pages' ? (
            page && (
              <div className="flex h-full flex-col gap-3">
                <div className="flex gap-2">
                  <Input
                    aria-label={t('settings.prompts.titleLabel')}
                    value={page.title}
                    disabled={busy}
                    onChange={(event) => setPage({ ...page, title: event.target.value })}
                  />
                  <Button disabled={!dirty || busy} onClick={savePage}>
                    {t('common.save')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!dirty || busy}
                    onClick={() => {
                      setPage(savedPage)
                      setEditorReset((value) => value + 1)
                    }}>
                    {t('common.cancel')}
                  </Button>
                  <Button variant="outline" disabled={dirty || busy} onClick={deletePage}>
                    {t('common.delete')}
                  </Button>
                </div>
                <Suspense fallback={<p>{t('common.loading')}</p>}>
                  <RichEditor
                    key={`${page.id}-${editorReset}`}
                    initialContent={savedPage?.body ?? ''}
                    onMarkdownChange={(body) => setPage((current) => (current ? { ...current, body } : current))}
                    autoFocus={false}
                    editable={!busy}
                    enableImageInsertion={false}
                  />
                </Suspense>
              </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Select value={tableId} onValueChange={setTableId}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tables.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterField} onValueChange={setFilterField}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((field) => (
                      <SelectItem key={field.id} value={field.name}>
                        {field.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="w-40"
                  value={filter}
                  placeholder={t('settings.mcp.filter.label')}
                  onChange={(event) => setFilter(event.target.value)}
                />
                <Select value={sortField} onValueChange={setSortField}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((field) => (
                      <SelectItem key={field.id} value={field.name}>
                        {field.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={() => setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'))}>
                  {t('selector.common.sort_label')} {sortDirection === 'asc' ? '↑' : '↓'}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="w-48"
                  value={newTitle}
                  placeholder={t('settings.prompts.titleLabel')}
                  onChange={(event) => setNewTitle(event.target.value)}
                />
                <Input
                  className="w-64"
                  value={newBody}
                  placeholder={t('settings.prompts.contentLabel')}
                  onChange={(event) => setNewBody(event.target.value)}
                />
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {memoryTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button disabled={busy || !newTitle.trim() || !newBody.trim()} onClick={createMemory}>
                  {t('common.add')}
                </Button>
              </div>
              {tab === 'memories' ? (
                memoryTypes.map((type) => {
                  const group = rows.rows.filter((row) => row.Type === type && row.Status === 'active')
                  return group.length ? (
                    <section key={type} className="space-y-2">
                      <h2 className="font-medium">{type}</h2>
                      <DataTable data={group} columns={columns} rowKey="_id" emptyText={t('agent.memory.empty')} />
                    </section>
                  ) : null
                })
              ) : (
                <DataTable data={rows.rows} columns={columns} rowKey="_id" emptyText={t('agent.memory.empty')} />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
