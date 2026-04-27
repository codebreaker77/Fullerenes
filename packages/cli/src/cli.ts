#!/usr/bin/env node

import { Command } from 'commander';
import { indexCommand } from './commands/index-cmd.js';
import { initCommand } from './commands/init.js';
import { mcpCommand } from './commands/mcp.js';
import { queryCommand } from './commands/query.js';
import { statsCommand } from './commands/stats.js';
import { watchCommand } from './commands/watch.js';

const program = new Command();

program
  .name('fullerenes')
  .description('Persistent local memory for AI coding agents')
  .version('0.1.4');

program
  .command('init [path]')
  .description('Run a full index and generate agent context files')
  .action((path) => initCommand(path));

program
  .command('index [path]')
  .description('Run an incremental reindex')
  .action((path) => indexCommand(path));

program
  .command('mcp [path]')
  .description('Start the Fullerenes MCP server on stdio')
  .action((path) => mcpCommand(path));

program
  .command('query <question>')
  .description('Query the local graph with a natural-language question')
  .option('-b, --budget <tokens>', 'Token budget', '2000')
  .option('-j, --json', 'Return JSON')
  .action((question, options) => queryCommand(question, options));

program
  .command('stats [path]')
  .description('Show local graph statistics')
  .action((path) => statsCommand(path));

program
  .command('watch [path]')
  .description('Watch the project and reindex on file changes')
  .action((path) => watchCommand(path));

program.parse(process.argv);
