import chalk from 'chalk';
import { getDbPath, initDatabase } from '@fullerenes/core';
import { startDaemon } from 'fullerenes-daemon';
import { generateClaudeMd } from '../generators/claude-md.js';
import { generateCursorRules } from '../generators/cursor-rules.js';

export async function watchCommand(pathStr?: string) {
  const rootDir = pathStr || process.cwd();
  console.log(chalk.blue('Starting Fullerenes watch mode on: ') + chalk.gray(rootDir));

  const daemon = startDaemon(rootDir, {
    debounceMs: 1000,
    regenerateConfig: true,
    onRegenerateConfig: async () => {
      const db = initDatabase(getDbPath(rootDir));
      await generateClaudeMd(rootDir, db);
      generateCursorRules(rootDir, db);
      db.close();
      console.log(chalk.blue('Regenerated CLAUDE.md, AGENTS.md, and Cursor rules.'));
    },
    onIndexed: (result) => {
      console.log(
        chalk.green('Indexed') +
          ` ${result.filesIndexed} files, ${chalk.green(`+${result.nodesAdded}`)} nodes, ${chalk.red(`-${result.nodesRemoved}`)} nodes removed`,
      );

      if (result.errors.length) {
        console.log(chalk.yellow(`Parsing warnings: ${result.errors.length}`));
      }
    },
    onError: (error) => {
      console.error(chalk.red('Watcher error:'), error.message);
    },
  });

  daemon.on('ready', () => {
    console.log(chalk.green('Watching for file changes... Press Ctrl+C to stop.'));
  });
}
