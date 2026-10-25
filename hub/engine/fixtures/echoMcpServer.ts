// Test fixture: a tiny stdio MCP server. Started by mcpClients.test.ts as `node --import tsx echoMcpServer.ts`.
// If ECHO_PID_FILE is set, it writes its pid there so the test can check the process is gone after disconnect.
import { writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

if (process.env.ECHO_PID_FILE) writeFileSync(process.env.ECHO_PID_FILE, String(process.pid));

const server = new McpServer({ name: 'echo-fixture', version: '0.1.0' });

server.registerTool(
  'echo',
  { description: 'Returns the text it was given.', inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: 'text' as const, text }] }),
);

server.registerTool(
  'headlines',
  { description: 'Two fixed headlines as a JSON array.', inputSchema: {} },
  async () => ({
    content: [{ type: 'text' as const, text: JSON.stringify([{ title: 'River level rising' }, { title: 'Power restored in ward 4' }]) }],
  }),
);

await server.connect(new StdioServerTransport());
