import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { sql } from '@vercel/postgres';
import { z } from 'zod';

async function buildApp() {
    const MCP_TOKEN = process.env.MCP_TOKEN;
    const SERVER_URL = process.env.SHORTLINKER_URL || 'https://go4l.ink';

    const app = Fastify({ logger: true });
    await app.register(cors, { origin: '*' });
    app.register(sensible);

    // --- Tool Implementation (unchanged) ---
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
        if (!rows.length) throw app.httpErrors.notFound('Link not found');
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
        if (!rowCount) throw app.httpErrors.notFound('Link not found');
        return { content: [{ type: 'text', text: `Deleted ${short_code}` }] };
      },
    };

    const toolDefinitions = Object.keys(tools).map(name => ({ name, description: `${name.replace(/_/g, ' ')} link(s)` }));

    const jsonRpcSuccess = (id, result) => ({ jsonrpc: '2.0', id, result });
    const jsonRpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

    const sendSse = (reply, event, data) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // --- Main Handler Logic ---
    app.all('/*', async (req, reply) => {
      // Authentication
      if (!MCP_TOKEN) {
        app.log.error('MCP_TOKEN is not configured.');
        throw app.httpErrors.internalServerError('Server configuration error');
      }
      const token = req.headers.authorization?.slice(7);
      if (token !== MCP_TOKEN) {
        throw app.httpErrors.unauthorized();
      }

      // SSE Handshake
      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      sendSse(reply, 'ready', {});

      // RPC Call Handling
      if (req.method === 'POST') {
        const { jsonrpc, id, method, params } = req.body;
        if (jsonrpc !== '2.0' || !method) {
          return sendSse(reply, 'jsonrpc', jsonRpcError(id ?? null, -32600, 'Invalid Request'));
        }

        try {
          if (method === 'tools/list') {
            sendSse(reply, 'jsonrpc', jsonRpcSuccess(id, { tools: toolDefinitions }));
          } else if (method === 'tools/call') {
            const name = params?.name;
            const args = params?.arguments;
            if (!tools[name]) {
              sendSse(reply, 'jsonrpc', jsonRpcError(id, -32601, `Method not found: ${name}`));
            } else {
              const result = await tools[name](args);
              sendSse(reply, 'jsonrpc', jsonRpcSuccess(id, result));
            }
          } else {
            sendSse(reply, 'jsonrpc', jsonRpcError(id, -32601, `Method not found: ${method}`));
          }
        } catch (error) {
          const message = error.message || 'Internal Server Error';
          const code = error.statusCode === 404 ? -32601 : -32603;
          sendSse(reply, 'jsonrpc', jsonRpcError(id, code, message));
        }
      }
      
      reply.raw.end();
    });

    await app.ready();
    return app;
}

const appPromise = buildApp();

// This file is now api/mcp.js, and Vercel routes /api/mcp to it.
// The Fastify server will handle any request that reaches it.

// --- Vercel Export ---
export default async (req, res) => {
    const app = await appPromise;
    app.server.emit('request', req, res);
}
