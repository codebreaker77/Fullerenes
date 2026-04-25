import { runMcpServer } from '../mcp/server.js';

export async function mcpCommand(pathStr?: string) {
  const rootDir = pathStr || process.cwd();
  await runMcpServer(rootDir);
}
