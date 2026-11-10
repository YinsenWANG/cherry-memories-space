import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

export async function startStdio(url, token) {
  const client = new Client({ name: 'cherry-memories-stdio', version: '0.1.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
  )
  const server = new Server({ name: 'cherry-studio-memories', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, () => client.listTools())
  server.setRequestHandler(CallToolRequestSchema, (request) => client.callTool(request.params))
  await server.connect(new StdioServerTransport())
}
