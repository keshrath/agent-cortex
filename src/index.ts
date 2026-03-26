import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { startDashboard } from './dashboard.js';

async function main() {
  const port = parseInt(process.env.KNOWLEDGE_PORT || '3423', 10);

  try {
    await startDashboard(port);
    process.stderr.write(`Dashboard: http://localhost:${port}\n`);
  } catch (err) {
    process.stderr.write(`Warning: Dashboard failed to start: ${err}\n`);
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
