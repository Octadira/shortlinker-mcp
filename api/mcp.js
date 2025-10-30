// api/mcp.js
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { sql } from '@vercel/postgres';
import { z } from 'zod';

function buildServer() {
  const srv = new Server({ name: 'shortlinker-neon-http', version: '1.0.0' }, { capabilities: { tools: {}, prompts: {} } });

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'create_short_link', description: 'Create a new shortened URL', inputSchema: { type: 'object', properties: { long_url: { type: 'string', format: 'uri' }, short_code: { type: 'string', pattern: '^[a-zA-Z0-9_-]{3,20}$' } }, required: ['long_url'] } },
      { name: 'get_link_info', description: 'Get information about a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } },
      { name: 'list_links', description: 'List all shortened links with statistics', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20, minimum: 1, maximum: 100 }, search: { type: 'string' } } } },
      { name: 'get_link_stats', description: 'Get detailed statistics for a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } },
      { name: 'delete_link', description: 'Delete a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } }
    ]
  }));

  const serverUrl = process.env.SHORTLINKER_URL || 'https://your-shortlinker-domain.com';

  srv.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'create_short_link': {
          const schema = z.object({ long_url: z.string().url(), short_code: z.string().optional() });
          const { long_url, short_code } = schema.parse(args);
          const code = short_code || (Math.random() + 1).toString(36).substring(2, 9);
          await sql`INSERT INTO links (long_url, short_code, clicks, created_at) VALUES (${long_url}, ${code}, 0, NOW())`;
          return { content: [{ type: 'text', text: `Created: ${serverUrl}/${code}` }] };
        }
        case 'get_link_info': {
          const schema = z.object({ short_code: z.string().min(1) });
          const { short_code } = schema.parse(args);
          const { rows } = await sql`SELECT * FROM links WHERE short_code = ${short_code}`;
          if (!rows.length) throw new Error('Not found');
          const link = rows[0];
          return { content: [{ type: 'text', text: `${serverUrl}/${link.short_code} -> ${link.long_url} (${link.clicks || 0} clicks)` }] };
        }
        case 'list_links': {
          const schema = z.object({ limit: z.number().min(1).max(100).optional().default(20), search: z.string().optional() });
          const { limit, search } = schema.parse(args || {});
          let q;
          if (search) q = sql`SELECT * FROM links WHERE long_url ILIKE ${`%${search}%`} OR short_code ILIKE ${`%${search}%`} ORDER BY created_at DESC LIMIT ${limit}`;
          else q = sql`SELECT * FROM links ORDER BY created_at DESC LIMIT ${limit}`;
          const { rows } = await q;
          const body = rows.map(r => `${serverUrl}/${r.short_code} -> ${r.long_url} (${r.clicks || 0})`).join('\n') || 'No links';
          return { content: [{ type: 'text', text: body }] };
        }
        case 'get_link_stats':
          return { content: [{ type: 'text', text: 'Use get_link_info for now' }] };
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
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  });

  srv.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
  srv.setRequestHandler(GetPromptRequestSchema, async () => { throw new Error('No prompts'); });

  return srv;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  const expected = process.env.MCP_TOKEN;
  if (!expected) return res.status(500).json({ error: 'MCP_TOKEN not configured' });
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7).trim() !== expected) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const srv = buildServer();
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const response = await srv.handleJSONRpc(body);
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(JSON.stringify(response));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}
