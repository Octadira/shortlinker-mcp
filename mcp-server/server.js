// mcp-server/server.js
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { sql } from '@vercel/postgres';

class ShortlinkerMCPServer {
  constructor() {
    this.server = new Server({ name: 'shortlinker-neon', version: '1.0.0' }, { capabilities: { tools: {}, prompts: {} } });
    this.serverUrl = process.env.SHORTLINKER_URL || 'https://your-shortlinker-domain.com';
    this.setupToolHandlers();
    this.setupPromptHandlers();
    this.setupErrorHandling();
  }
  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: 'create_short_link', description: 'Create a new shortened URL', inputSchema: { type: 'object', properties: { long_url: { type: 'string', format: 'uri' }, short_code: { type: 'string', pattern: '^[a-zA-Z0-9_-]{3,20}$' } }, required: ['long_url'] } },
        { name: 'get_link_info', description: 'Get information about a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } },
        { name: 'list_links', description: 'List all shortened links with statistics', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20, minimum: 1, maximum: 100 }, search: { type: 'string' } } } },
        { name: 'get_link_stats', description: 'Get detailed statistics for a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } },
        { name: 'delete_link', description: 'Delete a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      switch (name) {
        case 'create_short_link': {
          const schema = z.object({ long_url: z.string().url(), short_code: z.string().optional() });
          const { long_url, short_code } = schema.parse(args);
          const code = short_code || (Math.random() + 1).toString(36).substring(2, 9);
          await sql`INSERT INTO links (long_url, short_code, clicks, created_at) VALUES (${long_url}, ${code}, 0, NOW())`;
          return { content: [{ type: 'text', text: `Created: ${this.serverUrl}/${code}` }] };
        }
        case 'get_link_info': {
          const schema = z.object({ short_code: z.string().min(1) });
          const { short_code } = schema.parse(args);
          const { rows } = await sql`SELECT * FROM links WHERE short_code = ${short_code}`;
          if (!rows.length) throw new Error('Not found');
          const link = rows[0];
          return { content: [{ type: 'text', text: `${this.serverUrl}/${link.short_code} -> ${link.long_url} (${link.clicks || 0} clicks)` }] };
        }
        case 'list_links': {
          const schema = z.object({ limit: z.number().min(1).max(100).optional().default(20), search: z.string().optional() });
          const { limit, search } = schema.parse(args || {});
          let q;
          if (search) q = sql`SELECT * FROM links WHERE long_url ILIKE ${`%${search}%`} OR short_code ILIKE ${`%${search}%`} ORDER BY created_at DESC LIMIT ${limit}`;
          else q = sql`SELECT * FROM links ORDER BY created_at DESC LIMIT ${limit}`;
          const { rows } = await q;
          const body = rows.map(r => `${this.serverUrl}/${r.short_code} -> ${r.long_url} (${r.clicks || 0})`).join('\n') || 'No links';
          return { content: [{ type: 'text', text: body }] };
        }
        case 'get_link_stats':
          return await this.server.requestHandlers.get('tools/call')({ params: { name: 'get_link_info', arguments: args } });
        case 'delete_link': {
          const schema = z.object({ short_code: z.string().min(1) });
          const { short_code } = schema.parse(args);
          const { rowCount } = await sql`DELETE FROM links WHERE short_code = ${short_code}`;
          if (!rowCount) throw new Error('Not found');
          return { content: [{ type: 'text', text: `Deleted ${short_code}` }] };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }
  setupPromptHandlers() {
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
    this.server.setRequestHandler(GetPromptRequestSchema, async () => { throw new Error('No prompts'); });
  }
  setupErrorHandling() {
    this.server.onerror = (e) => console.error('[MCP Error]', e);
    process.on('SIGINT', async () => { await this.server.close(); process.exit(0); });
  }
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Shortlinker Neon MCP server running on stdio');
  }
}
const server = new ShortlinkerMCPServer();
server.run().catch(console.error);
