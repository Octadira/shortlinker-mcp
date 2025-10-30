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
  const srv = new Server({ name: 'shortlinker-neon-http', version: '1.1.0' }, { capabilities: { tools: {}, prompts: {} } });

  // Register handlers
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

  // Store dispatchers on instance for manual JSON-RPC routing
  srv.__toolDispatch = { create_short_link, get_link_info, list_links, get_link_stats, delete_link };
  srv.__handlers = {
    listTools: async () => await srv.requestHandlers.get(ListToolsRequestSchema.method)({ params: {} }),
  };

  return srv;
}

function jsonRpcSuccess(id, result) { return { jsonrpc: '2.0', id, result }; }
function jsonRpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

function writeSse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export default async function handler(req, res) {
  const expected = process.env.MCP_TOKEN;
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (!expected) return res.status(500).json({ error: 'MCP_TOKEN not configured' });
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7).trim() !== expected) return res.status(401).json({ error: 'Unauthorized' });

  // SSE via GET (LM Studio and others)
  if (req.method === 'GET') {
    // Only allow SSE when Accept asks for it
    const accept = req.headers['accept'] || '';
    if (!accept.includes('text/event-stream')) return res.status(405).json({ error: 'Method Not Allowed' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // Optionally send a hello event so clients confirm connection
    writeSse(res, { event: 'ready' });

    // Keep-alive ping every 25s
    const ping = setInterval(() => writeSse(res, { event: 'ping', ts: Date.now() }), 25000);

    req.on('close', () => { clearInterval(ping); try { res.end(); } catch {} });
    return; // SSE stream stays open
  }

  // JSON-RPC over POST
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { jsonrpc, id, method, params } = body || {};
  if (jsonrpc !== '2.0' || !method) return res.status(400).json(jsonRpcError(id ?? null, -32600, 'Invalid Request'));

  try {
    const srv = buildServer();

    // If client prefers SSE for response streaming on POST
    const wantsSse = (req.headers['accept'] || '').includes('text/event-stream');
    if (wantsSse) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      // Minimal JSON-RPC streaming: one event with result or error, then end
      const finish = (frame) => { writeSse(res, frame); try { res.end(); } catch {} };

      if (method === 'tools/list') {
        const result = await srv.__handlers.listTools();
        return finish(jsonRpcSuccess(id, result));
      }
      if (method === 'tools/call') {
        const { name, arguments: args } = params || {};
        if (!name || !(name in srv.__toolDispatch)) return finish(jsonRpcError(id, -32601, `Unknown tool: ${name}`));
        try { const result = await srv.__toolDispatch[name](args || {}); return finish(jsonRpcSuccess(id, result)); }
        catch (e) { return finish(jsonRpcError(id, -32000, e.message)); }
      }
      if (method === 'prompts/list') return finish(jsonRpcSuccess(id, { prompts: [] }));
      if (method === 'prompts/get') return finish(jsonRpcError(id, -32601, 'No prompts'));
      return finish(jsonRpcError(id, -32601, 'Method not found'));
    }

    // Regular JSON response
    if (method === 'tools/list') {
      const result = await srv.__handlers.listTools();
      return res.status(200).json(jsonRpcSuccess(id, result));
    }
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      if (!name || !(name in srv.__toolDispatch)) return res.status(200).json(jsonRpcError(id, -32601, `Unknown tool: ${name}`));
      try { const result = await srv.__toolDispatch[name](args || {}); return res.status(200).json(jsonRpcSuccess(id, result)); }
      catch (e) { return res.status(200).json(jsonRpcError(id, -32000, e.message)); }
    }
    if (method === 'prompts/list') return res.status(200).json(jsonRpcSuccess(id, { prompts: [] }));
    if (method === 'prompts/get') return res.status(200).json(jsonRpcError(id, -32601, 'No prompts'));

    return res.status(200).json(jsonRpcError(id, -32601, 'Method not found'));
  } catch (e) {
    return res.status(500).json(jsonRpcError(id ?? null, -32603, e.message));
  }
}
