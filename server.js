import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { sql } from '@vercel/postgres';
import { z } from 'zod';

// --- Configuration ---
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';
const MCP_TOKEN = process.env.MCP_TOKEN;
const SERVER_URL = process.env.SHORTLINKER_URL || 'https://go4l.ink';

// --- Fastify App Initialization ---
const fastify = Fastify({
  logger: true,
});

fastify.register(cors, { origin: '*' });
fastify.register(sensible);

// --- Tool Implementation ---
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
    if (!rows.length) throw fastify.httpErrors.notFound('Link not found');
    const link = rows[0];
    return { content: [{ type: 'text', text: `${SERVER_URL}/${link.short_code} -> ${link.long_url} (${link.clicks || 0} clicks)` }] };
  },
  list_links: async (args = {}) => {
    const schema = z.object({ limit: z.number().min(1).max(100).optional().default(20), search: z.string().optional() });
    const { limit, search } = schema.parse(args || {});
    const query = search
      ? sql`SELECT * FROM links WHERE long_url ILIKE ${`%${search}%`} OR short_code ILIKE ${`%${search}%`} ORDER BY created_at DESC LIMIT ${limit}`
      : sql`SELECT * FROM links ORDER BY created_at DESC LIMIT ${limit}`;
    const { rows } = await query;
    const body = rows.map(r => `${SERVER_URL}/${r.short_code} -> ${r.long_url} (${r.clicks || 0})`).join('\n') || 'No links found';
    return { content: [{ type: 'text', text: body }] };
  },
  get_link_stats: async (args) => tools.get_link_info(args),
  delete_link: async (args) => {
    const schema = z.object({ short_code: z.string().min(1) });
    const { short_code } = schema.parse(args || {});
    const { rowCount } = await sql`DELETE FROM links WHERE short_code = ${short_code}`;
    if (!rowCount) throw fastify.httpErrors.notFound('Link not found');
    return { content: [{ type: 'text', text: `Deleted ${short_code}` }] };
  },
};

const toolDefinitions = Object.keys(tools).map(name => ({ name, description: `${name.replace(/_/g, ' ')} link(s)` }));

// --- JSON-RPC Helper ---
const jsonRpcSuccess = (id, result) => ({ jsonrpc: '2.0', id, result });
const jsonRpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// --- SSE Stream Manager ---
const clients = new Set();
const broadcast = (event, data) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.raw.write(payload);
  }
};
setInterval(() => broadcast('ping', { ts: Date.now() }), 25000);

// --- Authentication Hook ---
fastify.addHook('preHandler', (request, reply, done) => {
  if (request.routeOptions.url === '/health') return done();

  if (!MCP_TOKEN) {
    fastify.log.error('MCP_TOKEN is not configured on the server.');
    throw fastify.httpErrors.internalServerError('Server configuration error');
  }
  const token = request.headers.authorization?.slice(7);
  if (token !== MCP_TOKEN) {
    throw fastify.httpErrors.unauthorized();
  }
  done();
});

// --- Routes ---
fastify.get('/health', (req, reply) => reply.send({ status: 'ok' }));

fastify.all('/mcp', (req, reply) => {
  const headers = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' };
  reply.raw.writeHead(200, headers);
  clients.add(reply);
  broadcast('ready', {});

  if (req.method === 'POST') {
    handleRpc(req.body);
  }

  req.socket.on('close', () => {
    clients.delete(reply);
  });
});

async function handleRpc(body) {
  const { jsonrpc, id, method, params } = body;
  if (jsonrpc !== '2.0' || !method) {
    return broadcast('jsonrpc', jsonRpcError(id ?? null, -32600, 'Invalid Request'));
  }

  try {
    if (method === 'tools/list') {
      return broadcast('jsonrpc', jsonRpcSuccess(id, { tools: toolDefinitions }));
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments;
      if (!tools[name]) {
        return broadcast('jsonrpc', jsonRpcError(id, -32601, `Method not found: ${name}`));
      }
      const result = await tools[name](args);
      return broadcast('jsonrpc', jsonRpcSuccess(id, result));
    }
    return broadcast('jsonrpc', jsonRpcError(id, -32601, `Method not found: ${method}`));
  } catch (error) {
    const message = error.message || 'Internal Server Error';
    const code = error.statusCode === 404 ? -32601 : -32603;
    return broadcast('jsonrpc', jsonRpcError(id, code, message));
  }
}

// --- Server Start ---
fastify.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
