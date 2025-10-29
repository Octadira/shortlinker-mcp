# Shortlinker MCP — Setup Guide

## Overview
- Remote HTTP JSON-RPC endpoint at `/mcp`, protected by Bearer token.
- Local STDIO mode for development (no HTTP, no token).
- Uses the same Neon (Vercel Postgres) as your app; DB secrets live only in Vercel.

## Remote on Vercel (secure)
1. Push this repo to GitHub and import it in Vercel.
2. In Vercel → Project → Settings → Environment Variables:
   - Add `MCP_TOKEN` (strong random value).
   - Add `SHORTLINKER_URL` (e.g., `https://go4l.ink`).
   - Postgres: ensure the Vercel project is connected to the same Neon DB (no secrets in clients).
3. Deploy. Endpoint is `POST https://<project>.vercel.app/mcp`.

## Quick test with cURL
```bash
curl -sS -X POST "https://<project>.vercel.app/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}' | jq .
```
Expected: a JSON-RPC response listing tools.

## MCP Clients (HTTP, with Bearer)
All clients must use:
- URL: `https://<project>.vercel.app/mcp`
- Header: `Authorization: Bearer <MCP_TOKEN>`

### Claude Desktop (HTTP)
If your version supports MCP-over-HTTP with custom headers, add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "shortlinker-mcp": {
      "url": "https://<project>.vercel.app/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_TOKEN>"
      }
    }
  }
}
```
If HTTP headers are not supported, use local STDIO (see below) or a trusted tunnel that injects the header.

### Cursor IDE (HTTP)
Add to `.cursor/mcp_config.json` in your workspace:
```json
{
  "mcp": {
    "servers": {
      "shortlinker-mcp": {
        "url": "https://<project>.vercel.app/mcp",
        "headers": {
          "Authorization": "Bearer <MCP_TOKEN>"
        }
      }
    }
  }
}
```

### VS Code with GitHub Copilot (HTTP)
Add to `.vscode/settings.json`:
```json
{
  "github.copilot.chat.mcp": {
    "servers": {
      "shortlinker-mcp": {
        "url": "https://<project>.vercel.app/mcp",
        "headers": {
          "Authorization": "Bearer <MCP_TOKEN>"
        }
      }
    }
  }
}
```

### Continue (VS Code Extension)
Add to `.continue/config.json`:
```json
{
  "mcp": {
    "servers": [
      {
        "name": "shortlinker-mcp",
        "url": "https://<project>.vercel.app/mcp",
        "headers": {
          "Authorization": "Bearer <MCP_TOKEN>"
        }
      }
    ]
  }
}
```

### Aider CLI (HTTP)
If your Aider build supports MCP over HTTP:
```bash
aider --mcp-http "shortlinker-mcp=https://<project>.vercel.app/mcp" \
      --mcp-http-header "shortlinker-mcp=Authorization: Bearer $MCP_TOKEN"
```

## Local development (STDIO)
```bash
cp mcp-server/.env.example .env  # fill only locally for Postgres
npm install
npm run dev
```
Configure clients to launch a local process instead of HTTP:
- command: `node`
- args: `["/absolute/path/to/mcp-server/server.js"]`
(No Authorization header is needed in STDIO mode.)

## Security notes
- Never share Postgres credentials with MCP clients.
- Rotate `MCP_TOKEN` periodically; revoke if leaked.
- Optionally enforce Cloudflare Access/IP allowlist/mTLS in front of `/mcp`.
