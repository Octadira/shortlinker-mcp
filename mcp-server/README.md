# Shortlinker MCP — Setup Guide

## Overview
- Remote HTTP JSON-RPC endpoint at `/mcp`, protected by Bearer token.
- Local STDIO mode for development (no HTTP, no token).
- Uses the same Neon (Vercel Postgres) as your app; DB secrets live only in Vercel.

## Remote on Vercel (secure)
1. Push this repo to GitHub and import it in Vercel.
2. In Vercel → Project → Settings → Environment Variables:
   - Add `MCP_TOKEN` (strong random value).
   - Copy the Postgres variables from the app project if needed for local dev (remote uses Vercel-provided env automatically).
   - Add `SHORTLINKER_URL` (e.g., `https://go4l.ink`).
3. Deploy. Endpoint is `POST https://<project>.vercel.app/mcp`.
4. Test:
   - Without `Authorization` → 401
   - With `Authorization: Bearer <MCP_TOKEN>` → valid JSON-RPC response.

## Local development (STDIO)
```bash
cp mcp-server/.env.example .env  # fill only locally
npm install
npm run dev
```
Configure your MCP client to launch: `node mcp-server/server.js`.

## MCP Client configuration (HTTP)
All clients must use:
- URL: `https://<your-mcp>.vercel.app/mcp`
- Header: `Authorization: Bearer <MCP_TOKEN>`

Examples:
- Claude / Cursor / VS Code Copilot / Continue / LM Studio / Aider: if HTTP MCP with custom headers is supported, set URL + header. Otherwise, use local STDIO.

## Security notes
- Never share Postgres credentials with MCP clients.
- Rotate `MCP_TOKEN` periodically.
- Optionally place Cloudflare Access / IP allowlist / mTLS in front of `/mcp`.
