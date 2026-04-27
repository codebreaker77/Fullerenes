import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  estimateTokenCount,
  getCallers,
  getCallees,
  getDbPath,
  getEntryPoints,
  getModules,
  getNodesByFile,
  getStats,
  getSubgraph,
  initDatabase,
  predictImpact,
  queryWithBudget,
  searchNodes,
} from 'fullerenes-core';

export async function runMcpServer(rootDir: string) {
  console.log = (...args) => console.error(...args);

  const db = initDatabase(getDbPath(rootDir));
  const server = new Server(
    {
      name: 'fullerenes',
      version: '0.1.4',
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
        description:
          'Query the Fullerenes knowledge graph with a natural-language question. Returns relevant functions, callers, entry points, and related files.',
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
        description:
          'Get details for a specific function or class, including file location, signature, callers, callees, and optionally the source body.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            includeBody: { type: 'boolean' },
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
        name: 'predict_impact',
        description:
          'Estimate which indexed nodes depend on a function or class and return a simple risk score before changing it.',
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
          const { question, maxTokens = 2000 } = request.params.arguments as {
            question: string;
            maxTokens?: number;
          };
          const result = queryWithBudget(db, question, maxTokens);
          return {
            content: [
              {
                type: 'text',
                text: `${result.text}\n\nApprox. token cost: ${result.estimatedTokens}`,
              },
            ],
          };
        }
        case 'get_function': {
          const { name, includeBody = false } = request.params.arguments as {
            name: string;
            includeBody?: boolean;
          };
          const node = searchNodes(db, name, 5).find((candidate) => candidate.type !== 'module');
          if (!node) {
            return { content: [{ type: 'text', text: `Function or class "${name}" not found.` }] };
          }

          const callers = getCallers(db, node.id, 10);
          const callees = getCallees(db, node.id, 10);
          const impact = predictImpact(db, node.id);
          let text = `Name: ${node.name} (${node.type})\n`;
          text += `File: ${node.filePath}:${node.lineStart ?? 1}\n`;
          text += `Signature: ${node.signature || 'N/A'}\n`;
          if (node.docstring) {
            text += `Docstring: ${node.docstring}\n`;
          }

          text += `\nCallers:\n${formatNodeList(callers)}\n`;
          text += `\nCallees:\n${formatNodeList(callees)}\n`;
          if (impact) {
            text += `\nImpact:\n- ${impact.summary}\n`;
          }

          if (includeBody) {
            const body = readNodeBody(rootDir, node.filePath, node.lineStart, node.lineEnd);
            if (body) {
              text += `\nBody:\n\`\`\`\n${body}\n\`\`\`\n`;
            }
          }

          return { content: [{ type: 'text', text }] };
        }
        case 'find_entry_points': {
          const entryPoints = getEntryPoints(db);
          const modules = getModules(db, 5);
          let text = 'Entry points:\n';
          for (const entryPoint of entryPoints) {
            text += `- ${entryPoint.filePath}:${entryPoint.lineStart ?? 1} (${entryPoint.outDegree} outgoing imports)\n`;
          }
          text += '\nTop modules by imports:\n';
          for (const module of modules) {
            text += `- ${module.path} (imported by ${module.importedByCount} files)\n`;
          }
          return { content: [{ type: 'text', text }] };
        }
        case 'get_file_context': {
          const { filePath } = request.params.arguments as { filePath: string };
          const nodes = getNodesByFile(db, filePath);
          let text = `Nodes in ${filePath}:\n`;
          for (const node of nodes.filter((candidate) => candidate.type !== 'module')) {
            text += `- ${node.name} (${node.type}) line ${node.lineStart ?? 1}`;
            if (node.signature) {
              text += ` - ${node.signature}`;
            }
            text += '\n';
          }
          return { content: [{ type: 'text', text }] };
        }
        case 'search_code': {
          const { query, limit = 10 } = request.params.arguments as { query: string; limit?: number };
          const nodes = searchNodes(db, query, limit);
          let text = `Search results for "${query}":\n`;
          for (const node of nodes) {
            text += `- ${node.name} (${node.type}) in ${node.filePath}:${node.lineStart ?? 1}\n`;
          }
          return { content: [{ type: 'text', text }] };
        }
        case 'get_callers': {
          const { functionName } = request.params.arguments as { functionName: string };
          const node = searchNodes(db, functionName, 5).find((candidate) => candidate.type !== 'module');
          if (!node) {
            return { content: [{ type: 'text', text: `No matches found for "${functionName}".` }] };
          }
          const callers = getCallers(db, node.id, 20);
          return {
            content: [
              {
                type: 'text',
                text: `Callers of ${functionName}:\n${formatNodeList(callers)}`,
              },
            ],
          };
        }
        case 'predict_impact': {
          const { functionName } = request.params.arguments as { functionName: string };
          const node = searchNodes(db, functionName, 5).find((candidate) => candidate.type !== 'module');
          if (!node) {
            return { content: [{ type: 'text', text: `No matches found for "${functionName}".` }] };
          }

          const impact = predictImpact(db, node.id);
          if (!impact) {
            return { content: [{ type: 'text', text: `No indexed impact data found for "${functionName}".` }] };
          }

          let text = `${impact.target.name} (${impact.target.filePath}:${impact.target.lineStart ?? 1})\n`;
          text += `${impact.summary}\n`;
          if (impact.directDependents.length > 0) {
            text += '\nDirect dependents:\n';
            for (const dependent of impact.directDependents) {
              text += `- ${dependent.name} (${dependent.filePath}:${dependent.lineStart ?? 1})\n`;
            }
          }
          if (impact.transitiveDependents.length > impact.directDependents.length) {
            text += '\nTransitive dependents:\n';
            for (const dependent of impact.transitiveDependents.filter((item) => item.depth > 1).slice(0, 10)) {
              text += `- ${dependent.name} (${dependent.filePath}:${dependent.lineStart ?? 1}) depth ${dependent.depth}\n`;
            }
          }

          return { content: [{ type: 'text', text }] };
        }
        case 'get_stats': {
          const stats = getStats(db);
          const summary = `Files: ${stats.fileCount}\nNodes: ${stats.nodeCount}\nEdges: ${stats.edgeCount}`;
          return {
            content: [{ type: 'text', text: `${summary}\nApprox. summary tokens: ${estimateTokenCount(summary)}` }],
          };
        }
        case 'get_subgraph': {
          const { nodeId, depth = 2 } = request.params.arguments as { nodeId: string; depth?: number };
          const subgraph = getSubgraph(db, nodeId, depth);
          let text = `Subgraph for ${nodeId} (depth ${depth}):\n`;
          text += `Nodes: ${subgraph.nodes.length}, Edges: ${subgraph.edges.length}\n`;
          for (const node of subgraph.nodes) {
            text += `- ${node.id}\n`;
          }
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

function formatNodeList(nodes: Array<{ name: string; filePath: string; lineStart: number | null }>): string {
  if (nodes.length === 0) {
    return '- none';
  }

  return nodes
    .map((node) => `- ${node.name} (${node.filePath}:${node.lineStart ?? 1})`)
    .join('\n');
}

function readNodeBody(
  rootDir: string,
  filePath: string,
  lineStart: number | null,
  lineEnd: number | null,
): string | null {
  if (!lineStart || !lineEnd || lineEnd < lineStart) {
    return null;
  }

  const absolutePath = join(rootDir, filePath);
  const source = readFileSync(absolutePath, 'utf8');
  const lines = source.split(/\r?\n/).slice(lineStart - 1, lineEnd);
  return lines.join('\n').trimEnd();
}
