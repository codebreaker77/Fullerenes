import chalk from 'chalk';
import cliProgress from 'cli-progress';
import { getDbPath, indexProject, initDatabase } from '@fullerenes/core';
import { generateClaudeMd } from '../generators/claude-md.js';
import { generateCursorRules } from '../generators/cursor-rules.js';

export async function initCommand(pathStr?: string) {
  const rootDir = pathStr || process.cwd();
  console.log(chalk.blue('Fullerenes'), 'Indexing project at', chalk.gray(rootDir));

  const bar = new cliProgress.SingleBar({
    format: `Indexing |${chalk.blue('{bar}')}| {percentage}% || {value}/{total} files || Current: {file}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });

  bar.start(100, 0, { file: 'Starting...' });

  const result = await indexProject(rootDir, {
    incremental: false,
    concurrency: 4,
    onProgress: (current, total, file) => {
      bar.setTotal(total);
      bar.update(current, { file });
    },
    onError: () => {
      // Keep the progress bar clean; parse warnings are reported afterwards.
    },
  });

  bar.stop();

  console.log(`\n${chalk.green('OK')} Indexing complete in ${chalk.yellow(`${result.durationMs}ms`)}`);
  console.log(`  Files: ${chalk.cyan(result.filesIndexed)} indexed, ${chalk.gray(result.filesSkipped)} skipped`);
  console.log(`  Nodes: ${chalk.cyan(result.nodesAdded)} added`);
  console.log(`  Edges: ${chalk.cyan(result.edgesAdded)} added`);

  if (result.errors.length) {
    console.log(chalk.yellow(`Warning: encountered parsing errors in ${result.errors.length} files.`));
  }

  console.log(chalk.blue('\nGenerating agent context files...'));
  const db = initDatabase(getDbPath(rootDir));
  await generateClaudeMd(rootDir, db);
  generateCursorRules(rootDir, db);
  db.close();

  console.log(chalk.green('OK') + ' Created CLAUDE.md, AGENTS.md, and .cursor/rules/fullerenes.mdc');
  console.log('\n' + chalk.bgBlue.white(' READY ') + ' Connect your agent with:');
  console.log(chalk.gray('  claude mcp add fullerenes -- npx fullerenes mcp'));
}
