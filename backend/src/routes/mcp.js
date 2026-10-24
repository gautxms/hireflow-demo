import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { createHireFlowMcpServer } from '../mcp/hireflowMcpServer.js'

export async function handleMcpRequest(req, res) {
  const server = createHireFlowMcpServer({ authorizationHeader: req.headers.authorization })
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined })

  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (error) {
    console.error('[MCP] Request failed:', { name: error?.name, code: error?.code })
    if (!res.headersSent) {
      return res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: req.body?.id ?? null,
      })
    }
  } finally {
    await transport.close().catch(() => {})
    await server.close().catch(() => {})
  }
}
