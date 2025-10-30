# Gemini Code-along Context: shortlinker-mcp

## Project Overview

This project is a **Model Context Protocol (MCP)** server for managing shortened links. It is built with Node.js and uses a Neon PostgreSQL database for storage. The server is designed to be used by AI models to programmatically manage short links.

The project has two main modes of operation:
1.  **HTTP Server:** An Express.js-based server that exposes MCP endpoints over HTTP. This is intended for production or remote access, supporting both standard JSON-RPC and Server-Sent Events (SSE) for streaming.
2.  **STDIO Server:** A server that communicates over standard input/output, intended for local development and direct process spawning.

### Key Technologies
- **Node.js:** The runtime environment.
- **Express.js:** Used for the HTTP server.
- **@modelcontextprotocol/sdk:** The core library for implementing the Model Context Protocol.
- **@vercel/postgres:** For connecting to and querying the Neon PostgreSQL database.
- **Zod:** For validating the arguments passed to the tools.

## Building and Running

### 1. Installation
To install the project dependencies, run:
```bash
npm install
```

### 2. Configuration
The server is configured using environment variables. A template is provided in `mcp-server/.env.example`. Copy this file to `mcp-server/.env` and fill in your database credentials and other settings.

**Key Environment Variables:**
- `MCP_TOKEN`: A secret bearer token for authenticating HTTP requests.
- `SHORTLINKER_URL`: The base URL for the generated short links (e.g., `https://go4l.ink`).
- `POSTGRES_URL`: The connection string for the Neon PostgreSQL database.
- `PORT`: The port for the HTTP server (defaults to `3001`).

### 3. Running the Server

There are three ways to run the server, defined in `package.json`:

- **Production HTTP Server:**
  ```bash
  npm start
  ```
  This starts the Express server defined in `mcp-http-server.js`.

- **Development HTTP Server:**
  ```bash
  npm run dev
  ```
  This runs the same server as `npm start` but sets `NODE_ENV=development`.

- **Local STDIO Server:**
  ```bash
  npm run stdio
  ```
  This starts the server defined in `mcp-server/server.js`, which communicates over STDIO.

## Development Conventions

### Code Style
- The project uses modern JavaScript with **ES Modules** (`import`/`export`).
- Asynchronous operations are handled using `async/await`.

### Tooling and Validation
- **Zod** is used to define schemas and validate the arguments for each tool, ensuring type safety and preventing invalid data.
- The **`@vercel/postgres`** library is used for all database interactions, providing a simple interface for executing SQL queries.

### Project Structure
- `mcp-http-server.js`: The entry point and implementation for the production-ready HTTP and SSE server.
- `mcp-server/server.js`: The entry point for the local STDIO server, designed for development.
- `package.json`: Defines project dependencies and scripts.
- `README.md`: Contains detailed setup and deployment instructions.

### Available Tools
The server exposes the following tools to the AI model:
- `create_short_link`: Creates a new shortened URL.
- `get_link_info`: Retrieves details for a specific short link.
- `list_links`: Lists all existing short links, with options for searching and limiting results.
- `get_link_stats`: Gets statistics for a short link (aliases `get_link_info`).
- `delete_link`: Deletes a short link.
