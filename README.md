# Shortlinker MCP — Secure Link Management for AI

**Model Context Protocol server** for managing shortened links with Neon PostgreSQL backend.

## 🚀 **Features**
- **Create/manage** shortened URLs with click tracking
- **List/search** links with statistics  
- **Bearer token** authentication
- **SSE streaming** support for persistent connections
- **Multiple deployment options**: VPS/CloudPanel + STDIO local

## 📋 **Tools Available for AI**
1. `create_short_link` - Create new shortened URLs
2. `get_link_info` - Get link details and stats
3. `list_links` - List all links with search
4. `get_link_stats` - Detailed link statistics
5. `delete_link` - Remove shortened links

---

## 🏗️ **VPS/CloudPanel Deployment (Recommended)**

### **Prerequisites**
- CloudPanel-managed VPS
- Domain/subdomain pointing to VPS
- Neon PostgreSQL database

### **Setup Steps**

1. **Create Node.js Site in CloudPanel**
   - Sites → Add Site → Node.js
   - Domain: `shortlinker-mcp.yourdomain.com`
   - Node.js Version: **20**
   - App Port: **3001**

2. **Deploy Code**
   ```bash
   # SSH as site user
   ssh shortlinker-mcp-yourdomain-com@YOUR_VPS_IP
   cd htdocs
   git clone https://github.com/Octadira/shortlinker-mcp.git .
   npm install
   ```

3. **Environment Variables** (CloudPanel → Site → Node.js → Settings)
   ```
   MCP_TOKEN=your-secure-random-token
   SHORTLINKER_URL=https://go4l.ink
   POSTGRES_URL=postgresql://user:pass@host:port/db
   POSTGRES_PRISMA_URL=postgresql://user:pass@host:port/db?pgbouncer=true
   POSTGRES_URL_NON_POOLING=postgresql://user:pass@host:port/db
   POSTGRES_USER=username
   POSTGRES_HOST=hostname
   POSTGRES_PASSWORD=password
   POSTGRES_DATABASE=database
   PORT=3001
   NODE_ENV=production
   ```

4. **Configure Node.js App**
   - Startup File: `mcp-http-server.js`
   - App Port: `3001`
   - **Restart** application

5. **SSL Certificate**
   - SSL/TLS → New Let's Encrypt Certificate
   - Create and Install

### **Endpoints**
- **HTTP MCP**: `https://shortlinker-mcp.yourdomain.com/mcp`
- **Health check**: `https://shortlinker-mcp.yourdomain.com/health`

---

## 🌊 **SSE Streaming Support**

The server supports Server-Sent Events for persistent connections (perfect for LM Studio, etc.).

### **SSE Heartbeat (GET)**
```bash
curl -N "https://shortlinker-mcp.yourdomain.com/mcp" \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer YOUR_TOKEN"
```
*Returns: `ready` event + periodic `ping` events*

### **JSON-RPC Streaming (POST)**
```bash
curl -N -X POST "https://shortlinker-mcp.yourdomain.com/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}'
```
*Returns: Single event with JSON-RPC result, then closes*

### **Regular JSON (POST)**
```bash
curl -sS -X POST "https://shortlinker-mcp.yourdomain.com/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}'
```
*Returns: Standard JSON response*

---

## 🤖 **Client Configurations**

### **LM Studio**
```json
{
  "mcpServers": {
    "shortlinker-mcp": {
      "url": "https://shortlinker-mcp.yourdomain.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

### **Gemini CLI**
```json
{
  "mcpServers": {
    "shortlinker-mcp": {
      "httpUrl": "https://shortlinker-mcp.yourdomain.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

### **Claude Desktop**
```json
{
  "mcpServers": {
    "shortlinker-mcp": {
      "url": "https://shortlinker-mcp.yourdomain.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

### **VS Code with Copilot**
```json
{
  "github.copilot.chat.mcp": {
    "servers": {
      "shortlinker-mcp": {
        "url": "https://shortlinker-mcp.yourdomain.com/mcp",
        "headers": {
          "Authorization": "Bearer YOUR_MCP_TOKEN"
        }
      }
    }
  }
}
```

---

## 💻 **Local STDIO Mode (Development)**

For local development or direct process spawning:

```bash
# Setup
cp mcp-server/.env.example mcp-server/.env
# Edit .env with your database credentials
npm install
npm run stdio
```

### **Client Config (STDIO)**
```json
{
  "mcpServers": {
    "shortlinker-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/shortlinker-mcp/mcp-server/server.js"],
      "env": {
        "POSTGRES_URL": "postgresql://...",
        "SHORTLINKER_URL": "https://go4l.ink"
      }
    }
  }
}
```

---

## 🔒 **Security**

- **Bearer Token**: All HTTP endpoints require `Authorization: Bearer TOKEN`
- **HTTPS Only**: Use SSL certificates for production
- **Database**: Credentials stored securely in environment variables
- **Rate Limiting**: Consider adding rate limiting for production use

### **Generate Secure Token**
```bash
openssl rand -hex 32
# or
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 🛠️ **Development**

### **Scripts**
- `npm start` - Production HTTP server
- `npm run dev` - Development HTTP server
- `npm run stdio` - Local STDIO server

### **Environment Variables**
| Variable | Description | Required |
|----------|-------------|----------|
| `MCP_TOKEN` | Bearer token for HTTP auth | HTTP only |
| `SHORTLINKER_URL` | Base URL for created links | Yes |
| `POSTGRES_URL` | Main database connection | Yes |
| `POSTGRES_*` | Additional Neon credentials | Yes |
| `PORT` | HTTP server port | No (3001) |
| `NODE_ENV` | Environment mode | No |

---

## 📦 **Project Structure**

```
shortlinker-mcp/
├── mcp-http-server.js          # Express HTTP server (VPS/CloudPanel)
├── mcp-server/
│   ├── server.js               # STDIO local server
│   └── .env.example            # Environment template
├── package.json                # Dependencies & scripts
└── README.md                   # This file
```

---

## 🐛 **Troubleshooting**

### **CloudPanel Issues**
- Check **Node.js logs** in CloudPanel dashboard
- Verify **App Port 3001** matches environment `PORT`
- Ensure **Startup File** is `mcp-http-server.js`
- Verify **SSL certificate** is active

### **Client Connection Issues**
- Test endpoint directly: `curl -I https://yourdomain.com/health`
- Verify Bearer token is correct
- Check **firewall/proxy** settings
- For LM Studio: Look for **SSE connection** logs

### **Database Issues**
- Test connection: `curl -X POST .../mcp -H "Auth..." -d '{"jsonrpc":"2.0","method":"tools/list"}'`
- Verify **Neon database** is accessible
- Check **environment variables** are set correctly

---

## 📄 **License**

MIT License - see repository for details.
