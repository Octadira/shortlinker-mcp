module.exports = {
  apps: [{
    name: 'shortlinker-mcp',
    script: 'mcp-http-server.js',
    interpreter: '/home/go4l-shortlinker-mcp/.nvm/versions/node/v22.21.1/bin/node',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      MCP_TOKEN: 'SL-27b4bfae6760524ad9b1df8974f50da676ecccf7109c24c7f3bd81e0966819f0',
      SHORTLINKER_URL: 'https://go4l.ink',
      POSTGRES_URL: 'postgres://neondb_owner:npg_FSQLV4AzK1sq@ep-flat-smoke-a2e5g3n1-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require'
    }
  }]
};
