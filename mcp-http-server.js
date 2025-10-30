import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { sql } from '@vercel/postgres';
import { z } from 'zod';

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

// SSE tuning
const SSE_PING_MS = 25000; // 25s ping to keep proxies alive

function buildServer() {
  const srv = new Server({ name: 'shortlinker-neon-vps', version: '1.3.2' }, { capabilities: { tools: {}, prompts: {} } });

  const serverUrl = process.env.SHORTLINKER_URL || 'https://go4l.ink';

  async function create_short_link(args) {
    const schema = z.object({ long_url: z.string().url(), short_code: z.string().optional() });
    const { long_url, short_code } = schema.parse(args || {});
    const code = short_code || (Math.random() + 1).toString(36).substring(2, 9);
    await sql`INSERT INTO links (long_url, short_code, clicks, created_at) VALUES (${long_url}, ${code}, 0, NOW())`;
    return { content: [{ type: 'text', text: `Created: ${serverUrl}/${code}` }] };
  }

  async function get_link_info(args) {
    const schema = z.object({ short_code: z.string().min(1) });
    const { short_code } = schema.parse(args || {});
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
    const { short_code } = schema.parse(args || {});
    const { rowCount } = await sql`DELETE FROM links WHERE short_code = ${short_code}`;
    if (!rowCount) throw new Error('Not found');
    return { content: [{ type: 'text', text: `Deleted ${short_code}` }] };
  }

  srv.__toolDispatch = { create_short_link, get_link_info, list_links, get_link_stats, delete_link };
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
function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Proper SSE endpoint compatible with LM Studio / Gemini CLI
app.get('/mcp', (req, res) => {
  const expected = process.env.MCP_TOKEN;
  const auth = req.headers['authorization'];
  if (!expected) return res.status(500).json({ error: 'MCP_TOKEN not configured' });
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7).trim() !== expected) return res.status(401).json({ error: 'Unauthorized' });

  // Send headers ONCE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering in Nginx

  // Immediately send a ready event
  writeSse(res, 'ready', {});

  // Keep-alive ping
  const ping = setInterval(() => writeSse(res, 'ping', { ts: Date.now() }), SSE_PING_MS);

  // Cleanup on disconnect
  req.on('close', () => { clearInterval(ping); try { res.end(); } catch {} });
});

// JSON and streaming RPC over POST
app.post('/mcp', async (req, res) => {
  const expected = process.env.MCP_TOKEN;
  const auth = req.headers['authorization'];
  if (!expected) return res.status(500).json({ error: 'MCP_TOKEN not configured' });
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7).trim() !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const accept = req.headers['accept'] || '';
  const wantsSse = accept.includes('text/event-stream');

  let body = req.body || {};
  const { jsonrpc, id, method, params } = body;
  if (jsonrpc !== '2.0' || !method) return res.status(400).json(jsonRpcError(id ?? null, -32600, 'Invalid Request'));

  const srv = buildServer();

  const handleCall = async () => {
    if (method === 'tools/list') return jsonRpcSuccess(id, await srv.__handlers.listTools());
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      if (!name || !(name in srv.__toolDispatch)) return jsonRpcError(id, -32601, `Unknown tool: ${name}`);
      const result = await srv.__toolDispatch[name](args || {});
      return jsonRpcSuccess(id, result);
    }
    if (method === 'prompts/list') return jsonRpcSuccess(id, { prompts: [] });
    if (method === 'prompts/get') return jsonRpcError(id, -32601, 'No prompts');
    return jsonRpcError(id, -32601, 'Method not found');
  };

  try {
    const frame = await handleCall();
    if (!wantsSse) return res.status(200).json(frame);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering in Nginx
    writeSse(res, 'jsonrpc', frame);
    try { res.end(); } catch {}
  } catch (e) {
    const frame = jsonRpcError(id ?? null, -32603, e.message || 'Internal error');
    if (!wantsSse) return res.status(500).json(frame);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering in Nginx
    writeSse(res, 'jsonrpc', frame);
    try { res.end(); } catch {}
  }
});

app.get('/health', (req, res) => { res.json({ status: 'ok', service: 'shortlinker-mcp', version: '1.3.2' }); });

app.listen(PORT, () => {
  console.log(`🚀 Shortlinker MCP Server running on port ${PORT}`);
  console.log(`📡 MCP endpoint: http://localhost:${PORT}/mcp`);
});
