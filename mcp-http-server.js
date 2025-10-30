// mcp-http-server.js
// A robust, simplified MCP server for Shortlinker with a focus on SSE compatibility.

import express from 'express';
import cors from 'cors';
import { sql } from '@vercel/postgres';
import { z } from 'zod';

// --- Configuration ---
const PORT = process.env.PORT || 3001;
const SSE_PING_MS = 25000; // 25s ping to keep proxies alive
const SERVER_URL = process.env.SHORTLINKER_URL || 'https://go4l.ink';
const MCP_TOKEN = process.env.MCP_TOKEN;

// --- Express App Initialization ---
const app = express();
app.use(cors());
app.use(express.json());

// --- SSE Helper ---
// Formats and writes a Server-Sent Event to the response stream.
function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// --- Authentication Middleware ---
// Checks for a valid bearer token on requests to protected endpoints.
const checkAuth = (req, res, next) => {
  if (!MCP_TOKEN) {
    console.error('MCP_TOKEN is not configured on the server.');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7);

  if (token === MCP_TOKEN) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
};

// --- Tool Implementation ---
// The core logic for each tool.
const tools = {
  create_short_link: async (args) => {
    const schema = z.object({ long_url: z.string().url(), short_code: z.string().optional() });
    const { long_url, short_code } = schema.parse(args || {});
    const code = short_code || (Math.random() + 1).toString(36).substring(2, 9);
    await sql`INSERT INTO links (long_url, short_code, clicks, created_at) VALUES (${long_url}, ${code}, 0, NOW())`;
    return { content: [{ type: 'text', text: `Created: ${SERVER_URL}/${code}` }] };
  },
  get_link_info: async (args) => {
    const schema = z.object({ short_code: z.string().min(1) });
    const { short_code } = schema.parse(args || {});
    const { rows } = await sql`SELECT * FROM links WHERE short_code = ${short_code}`;
    if (!rows.length) throw new Error('Not found');
    const link = rows[0];
    return { content: [{ type: 'text', text: `${SERVER_URL}/${link.short_code} -> ${link.long_url} (${link.clicks || 0} clicks)` }] };
  },
  list_links: async (args = {}) => {
    const schema = z.object({ limit: z.number().min(1).max(100).optional().default(20), search: z.string().optional() });
    const { limit, search } = schema.parse(args || {});
    let q;
    if (search) {
      q = sql`SELECT * FROM links WHERE long_url ILIKE ${`%${search}%`} OR short_code ILIKE ${`%${search}%`} ORDER BY created_at DESC LIMIT ${limit}`;
    } else {
      q = sql`SELECT * FROM links ORDER BY created_at DESC LIMIT ${limit}`;
    }
    const { rows } = await q;
    const body = rows.map(r => `${SERVER_URL}/${r.short_code} -> ${r.long_url} (${r.clicks || 0})`).join('\n') || 'No links';
    return { content: [{ type: 'text', text: body }] };
  },
  get_link_stats: async (args) => {
    // This is an alias for get_link_info
    return tools.get_link_info(args);
  },
  delete_link: async (args) => {
    const schema = z.object({ short_code: z.string().min(1) });
    const { short_code } = schema.parse(args || {});
    const { rowCount } = await sql`DELETE FROM links WHERE short_code = ${short_code}`;
    if (!rowCount) throw new Error('Not found');
    return { content: [{ type: 'text', text: `Deleted ${short_code}` }] };
  }
};

const toolDefinitions = [
    { name: 'create_short_link', description: 'Create a new shortened URL', inputSchema: { type: 'object', properties: { long_url: { type: 'string', format: 'uri' }, short_code: { type: 'string', pattern: '^[a-zA-Z0-9_-]{3,20}$' } }, required: ['long_url'] } },
    { name: 'get_link_info', description: 'Get information about a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } },
    { name: 'list_links', description: 'List all shortened links with statistics', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20, minimum: 1, maximum: 100 }, search: { type: 'string' } } } },
    { name: 'get_link_stats', description: 'Get detailed statistics for a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } },
    { name: 'delete_link', description: 'Delete a shortened link', inputSchema: { type: 'object', properties: { short_code: { type: 'string' } }, required: ['short_code'] } }
];


// --- JSON-RPC Helper ---
function jsonRpcSuccess(id, result) { return { jsonrpc: '2.0', id, result }; }
function jsonRpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }


// --- Main MCP Endpoint ---
// Handles both initial connection (GET) and RPC calls (POST) over a single SSE stream.
app.all('/mcp', checkAuth, async (req, res) => {
  // Set SSE headers for all /mcp requests
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no'); // Critical for Nginx/proxies

  // The 'ready' event and keep-alive pings are sent to establish and maintain the connection.
  writeSse(res, 'ready', {});
  const pingInterval = setInterval(() => {
    writeSse(res, 'ping', { ts: Date.now() });
  }, SSE_PING_MS);

  // Clean up when the client disconnects
  req.on('close', () => {
    clearInterval(pingInterval);
    res.end();
  });

  // For POST requests, we handle the RPC call but don't establish a new connection logic,
  // as the client is expected to use the already open stream.
  if (req.method === 'POST') {
    const { jsonrpc, id, method, params } = req.body;

    if (jsonrpc !== '2.0' || !method) {
      const errorFrame = jsonRpcError(id ?? null, -32600, 'Invalid Request');
      writeSse(res, 'jsonrpc', errorFrame);
      return;
    }

    let resultFrame;
    try {
      if (method === 'tools/list') {
        resultFrame = jsonRpcSuccess(id, { tools: toolDefinitions });
      } else if (method === 'tools/call') {
        const { name, arguments: args } = params || {};
        if (!name || !tools[name]) {
          resultFrame = jsonRpcError(id, -32601, `Method not found: ${name}`);
        } else {
          const toolResult = await tools[name](args);
          resultFrame = jsonRpcSuccess(id, toolResult);
        }
      } else {
        resultFrame = jsonRpcError(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'An internal error occurred';
      resultFrame = jsonRpcError(id, -32603, errorMessage);
    }
    
    writeSse(res, 'jsonrpc', resultFrame);
  }
});


// --- Health Check Endpoint ---
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'shortlinker-mcp',
    version: '1.3.2' // This should match package.json
  });
});

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`🚀 Shortlinker MCP Server running on port ${PORT}`);
  console.log(`📡 MCP endpoint: http://localhost:${PORT}/mcp`);
  if (!MCP_TOKEN) {
    console.warn('⚠️  Warning: MCP_TOKEN is not set. The server is insecure.');
  }
});