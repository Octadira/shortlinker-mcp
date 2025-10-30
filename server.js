import 'dotenv/config';
import Fastify from 'fastify';

const fastify = Fastify({
  logger: true
});

const port = process.env.PORT || 3001;

fastify.get('/', (request, reply) => {
  reply.send({ 
    message: 'Hello World! The server is running.',
    port: port,
    mcp_token_loaded: !!process.env.MCP_TOKEN,
    postgres_url_loaded: !!process.env.POSTGRES_URL
  });
});

fastify.listen({ port: port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Server listening on ${address}`);
});
