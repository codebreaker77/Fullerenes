import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  getCallers,
  getCallees,
  getDbPath,
  getEntryPoints,
  getModules,
  getNodesByFile,
  getStats,
  getSubgraph,
  initDatabase,
  queryWithBudget,
  searchNodes,
} from '@fullerenes/core';

export async function runMcpServer(rootDir: string) {
  console.log = (...args) => console.error(...args);

  const db = initDatabase(getDbPath(rootDir));

  const server = new Server(
    {
      name: 'fullerenes',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'query_codebase',
        description: 'Query the Fullerenes knowledge graph with a natural-language question.',
        inputSchema: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            maxTokens: { type: 'number' },
          },
          required: ['question'],
        },
      },
      {
        name: 'get_function',
        description: 'Get details for a specific function or class.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
      },
      {
        name: 'find_entry_points',
        description: 'Find the main entry points and top-level modules.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_file_context',
        description: 'Get all functions and classes in a specific file.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'search_code',
        description: 'Search for functions, classes, or modules by name.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_callers',
        description: 'Find all code that calls a specific function.',
        inputSchema: {
          type: 'object',
          properties: {
            functionName: { type: 'string' },
          },
          required: ['functionName'],
        },
      },
      {
        name: 'get_stats',
        description: 'Get statistics about the indexed codebase.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_subgraph',
        description: 'Get a node and its neighborhood up to N hops.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeId: { type: 'string' },
            depth: { type: 'number' },
          },
          required: ['nodeId'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      switch (request.params.name) {
        case 'query_codebase': {
          const { question, maxTokens = 2000 } = request.params.arguments as { question: string; maxTokens?: number };
          const result = queryWithBudget(db, question, maxTokens);
          return { content: [{ type: 'text', text: result.text }] };
        }
        case 'get_function': {
          const { name } = request.params.arguments as { name: string };
          const nodes = searchNodes(db, name, 1);
          if (!nodes.length) {
            return { content: [{ type: 'text', text: `Function or class "${name}" not found.` }] };
          }

          const node = nodes[0]!;
          const callers = getCallers(db, node.id);
          const callees = getCallees(db, node.id);
          let text = `Name: ${node.name} (${node.type})\nFile: ${node.filePath}\nSignature: ${node.signature || 'N/A'}\n\nCallers:\n`;
          callers.forEach((caller) => {
            text += `- ${caller.name} in ${caller.filePath}\n`;
          });
          text += `\nCallees:\n`;
          callees.forEach((callee) => {
            text += `- ${callee.name} in ${callee.filePath}\n`;
          });
          return { content: [{ type: 'text', text }] };
        }
        case 'find_entry_points': {
          const entryPoints = getEntryPoints(db);
          const modules = getModules(db, 5);
          let text = 'Entry points:\n';
          entryPoints.forEach((entryPoint) => {
            text += `- ${entryPoint.filePath}\n`;
          });
          text += '\nTop modules by imports:\n';
          modules.forEach((module) => {
            text += `- ${module.path} (imported by ${module.importedByCount})\n`;
          });
          return { content: [{ type: 'text', text }] };
        }
        case 'get_file_context': {
          const { filePath } = request.params.arguments as { filePath: string };
          const nodes = getNodesByFile(db, filePath);
          let text = `Nodes in ${filePath}:\n`;
          nodes.forEach((node) => {
            text += `- ${node.name} (${node.type}) line ${node.lineStart}\n`;
          });
          return { content: [{ type: 'text', text }] };
        }
        case 'search_code': {
          const { query, limit = 10 } = request.params.arguments as { query: string; limit?: number };
          const nodes = searchNodes(db, query, limit);
          let text = `Search results for "${query}":\n`;
          nodes.forEach((node) => {
            text += `- ${node.name} (${node.type}) in ${node.filePath}\n`;
          });
          return { content: [{ type: 'text', text }] };
        }
        case 'get_callers': {
          const { functionName } = request.params.arguments as { functionName: string };
          const nodes = searchNodes(db, functionName, 1);
          if (!nodes.length) {
            return { content: [{ type: 'text', text: `No matches found for "${functionName}".` }] };
          }
          const callers = getCallers(db, nodes[0]!.id);
          let text = `Callers of ${functionName}:\n`;
          callers.forEach((caller) => {
            text += `- ${caller.name} in ${caller.filePath}\n`;
          });
          return { content: [{ type: 'text', text }] };
        }
        case 'get_stats': {
          const stats = getStats(db);
          return {
            content: [{ type: 'text', text: `Files: ${stats.fileCount}\nNodes: ${stats.nodeCount}\nEdges: ${stats.edgeCount}` }],
          };
        }
        case 'get_subgraph': {
          const { nodeId, depth = 2 } = request.params.arguments as { nodeId: string; depth?: number };
          const subgraph = getSubgraph(db, nodeId, depth);
          let text = `Subgraph for ${nodeId} (depth ${depth}):\nNodes: ${subgraph.nodes.length}, Edges: ${subgraph.edges.length}\n`;
          subgraph.nodes.forEach((node) => {
            text += `- ${node.id}\n`;
          });
          return { content: [{ type: 'text', text }] };
        }
        default:
          throw new Error('Unknown tool');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error executing tool: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Fullerenes MCP server running.');
  console.error('claude mcp add fullerenes -- npx fullerenes mcp');
}
