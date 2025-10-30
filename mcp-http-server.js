import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { sql } from '@vercel/postgres';
import { z } from 'zod';

// Express HTTP server for MCP (VPS/CloudPanel/PM2)
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

const FIVE_MIN_MS = 10 * 60 * 1000; // VPS can handle long-running, keep generous window
const SSE_PING_MS = 30 * 1000;
const SSE_GRACE_MS = 10 * 1000;

function buildServer() {
  console.log('🔍 Building server...');
  const srv = new Server({ name: 'shortlinker-neon-vps', version: '1.3.0' }, { capabilities: { tools: {}, prompts: {} } });
  console.log('✅ Server created:', srv);
  console.log('🔍 requestHandlers:', srv.requestHandlers);
  
  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'create_short_link', description: 'Create a new shortened URL', inputSchema: { type: 'object', properties: { long_url: { type: 'string', format: 'uri' }, short_code: { type: 'string', pattern: '^[a-zA-Z0-9_-]{3,20}$' } }, required: ['long_url'] } },
      { name: 'get_link_info', description: 'Get information about a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } },
      { name: 'list_links', description: 'List all shortened links with statistics', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20, minimum: 1, maximum: 100 }, search: { type: 'string' } } } },
      { name: 'get_link_stats', description: 'Get detailed statistics for a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } },
      { name: 'delete_link', description: 'Delete a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } }
    ]
  }));

  const srv2 = new Server({ name: 'shortlinker-neon-vps', version: '1.3.0' }, { capabilities: { tools: {}, prompts: {} } });
  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'create_short_link', description: 'Create a new shortened URL', inputSchema: { type: 'object', properties: { long_url: { type: 'string', format: 'uri' }, short_code: { type: 'string', pattern: '^[a-zA-Z0-9_-]{3,20}$' } }, required: ['long_url'] } },
      { name: 'get_link_info', description: 'Get information about a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } },
      { name: 'list_links', description: 'List all shortened links with statistics', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20, minimum: 1, maximum: 100 }, search: { type: 'string' } } } },
      { name: 'get_link_stats', description: 'Get detailed statistics for a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } },
      { name: 'delete_link', description: 'Delete a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } }
    ]
  }));

  const serverUrl = process.env.SHORTLINKER_URL || 'https://go4l.ink';

  async function create_short_link(args) {
    const schema = z.object({ long_url: z.string().url(), short_code: z.string().optional() });
    const { long_url, short_code } = schema.parse(args);
    const code = short_code || (Math.random() + 1).toString(36).substring(2, 9);
    await sql`INSERT INTO links (long_url, short_code, clicks, created_at) VALUES (${long_url}, ${code}, 0, NOW())`;
    return { content: [{ type: 'text', text: `Created: ${serverUrl}/${code}` }] };
  }
  async function get_link_info(args) {
    const schema = z.object({ short_code: z.string().min(1) });
    const { short_code } = schema.parse(args);
    const { rows } = await sql`SELECT * FROM links WHERE short_code = ${short_code}`;
    if (!rows.length) throw new Error('Not found');
    const link = rows[0];
    return { content: [{ type: 'text', text: `${serverUrl}/${link.short_code} -> ${link.long_url} (${link.clicks || 0} clicks)` }] };
  }
  async function list_links(args = {}) {
    const schema = z.object({ limit: z.number().min(1).max(100).optional().default(20), search: z.string().optional() });
    const { limit, search } = schema.parse(args || {});
    let q;
    if (search) q = sql`SELECT * FROM links WHERE long_url ILIKE ${`%${search}%`} OR short_code ILIKE ${`%${search}%`} ORDER BY created_at DESC LIMIT ${limit}`;
    else q = sql`SELECT * FROM links ORDER BY created_at DESC LIMIT ${limit}`;
    const { rows } = await q;
    const body = rows.map(r => `${serverUrl}/${r.short_code} -> ${r.long_url} (${r.clicks || 0})`).join('\n') || 'No links';
    return { content: [{ type: 'text', text: body }] };
  }
  async function get_link_stats(args) { return get_link_info(args); }
  async function delete_link(args) {
    const schema = z.object({ short_code: z.string().min(1) });
    const { short_code } = schema.parse(args);
    const { rowCount } = await sql`DELETE FROM links WHERE short_code = ${short_code}`;
    if (!rowCount) throw new Error('Not found');
    return { content: [{ type: 'text', text: `Deleted ${short_code}` }] };
  }

  // Direct tools response instead of handler delegation
srv.__handlers = { 
  listTools: async () => ({
    tools: [
      { name: 'create_short_link', description: 'Create a new shortened URL', inputSchema: { type: 'object', properties: { long_url: { type: 'string', format: 'uri' }, short_code: { type: 'string', pattern: '^[a-zA-Z0-9_-]{3,20}$' } }, required: ['long_url'] } },
      { name: 'get_link_info', description: 'Get information about a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } },
      { name: 'list_links', description: 'List all shortened links with statistics', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20, minimum: 1, maximum: 100 }, search: { type: 'string' } } } },
      { name: 'get_link_stats', description: 'Get detailed statistics for a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } },
      { name: 'delete_link', description: 'Delete a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } }
    ]
  })
};

  return srv;
}

function jsonRpcSuccess(id, result) { return { jsonrpc: '2.0', id, result }; }
function jsonRpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
function writeSse(res, data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

app.all('/mcp', async (req, res) => {
  const expected = process.env.MCP_TOKEN;
  const auth = req.headers['authorization'];
  if (!expected) return res.status(500).json({ error: 'MCP_TOKEN not configured' });
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7).trim() !== expected) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const accept = req.headers['accept'] || '';
    if (!accept.includes('text/event-stream')) return res.status(405).json({ error: 'Method Not Allowed' });

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    writeSse(res, { event: 'ready' });

    const ping = setInterval(() => writeSse(res, { event: 'ping', ts: Date.now() }), SSE_PING_MS);
    const graceClose = setTimeout(() => { writeSse(res, { event: 'closing', reason: 'server_timeout_incoming', reconnect: true }); try { res.end(); } catch {} }, FIVE_MIN_MS - SSE_GRACE_MS);
    req.on('close', () => { clearInterval(ping); clearTimeout(graceClose); try { res.end(); } catch {} });
    return;
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { jsonrpc, id, method, params } = req.body || {};
  if (jsonrpc !== '2.0' || !method) return res.status(400).json(jsonRpcError(id ?? null, -32600, 'Invalid Request'));

  const srv = buildServer();
  const wantsSse = (req.headers['accept'] || '').includes('text/event-stream');

  if (wantsSse) {
    if (!res.headersSent) { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' }); }
    const finish = (frame) => { writeSse(res, frame); try { res.end(); } catch {} };

    try {
      if (method === 'tools/list') { const result = await srv.__handlers.listTools(); return finish(jsonRpcSuccess(id, result)); }
      if (method === 'tools/call') {
        const { name, arguments: args } = params || {};
        if (!name || !(name in srv.__toolDispatch)) return finish(jsonRpcError(id, -32601, `Unknown tool: ${name}`));
        const result = await srv.__toolDispatch[name](args || {});
        return finish(jsonRpcSuccess(id, result));
      }
      if (method === 'prompts/list') return finish(jsonRpcSuccess(id, { prompts: [] }));
      if (method === 'prompts/get') return finish(jsonRpcError(id, -32601, 'No prompts'));
      return finish(jsonRpcError(id, -32601, 'Method not found'));
    } catch (e) {
      return finish(jsonRpcError(id ?? null, -32603, e.message));
    }
  }

  try {
    if (method === 'tools/list') { const result = await srv.__handlers.listTools(); return res.status(200).json(jsonRpcSuccess(id, result)); }
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      if (!name || !(name in srv.__toolDispatch)) return res.status(200).json(jsonRpcError(id, -32601, `Unknown tool: ${name}`));
      const result = await srv.__toolDispatch[name](args || {});
      return res.status(200).json(jsonRpcSuccess(id, result));
    }
    if (method === 'prompts/list') return res.status(200).json(jsonRpcSuccess(id, { prompts: [] }));
    if (method === 'prompts/get') return res.status(200).json(jsonRpcError(id, -32601, 'No prompts'));
    return res.status(200).json(jsonRpcError(id, -32601, 'Method not found'));
  } catch (e) {
    return res.status(500).json(jsonRpcError(id ?? null, -32603, e.message));
  }
});

app.get('/health', (req, res) => { res.json({ status: 'ok', service: 'shortlinker-mcp', version: '1.3.0' }); });

app.listen(PORT, () => {
  console.log(`🚀 Shortlinker MCP Server running on port ${PORT}`);
  console.log(`📡 MCP endpoint: http://localhost:${PORT}/mcp`);
});
