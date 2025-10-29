// mcp-server/auth.js
export function requireBearer(req, res) {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  const expected = process.env.MCP_TOKEN;
  if (!expected) { res.status(500).json({ error: 'MCP_TOKEN not configured' }); return false; }
  if (!auth || !auth.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing Authorization: Bearer token' }); return false; }
  const token = auth.slice('Bearer '.length).trim();
  if (token !== expected) { res.status(401).json({ error: 'Invalid token' }); return false; }
  return true;
}
