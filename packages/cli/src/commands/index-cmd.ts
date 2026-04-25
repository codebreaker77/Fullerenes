import chalk from 'chalk';
import ora from 'ora';
import { getDbPath, indexProject, initDatabase } from '@fullerenes/core';
import { generateClaudeMd } from '../generators/claude-md.js';
import { generateCursorRules } from '../generators/cursor-rules.js';

export async function indexCommand(pathStr?: string) {
  const rootDir = pathStr || process.cwd();
  const spinner = ora(`Re-indexing ${chalk.gray(rootDir)} incrementally...`).start();

  const result = await indexProject(rootDir, {
    incremental: true,
    concurrency: 4,
  });

  spinner.succeed(`Incremental sync complete in ${chalk.yellow(`${result.durationMs}ms`)}`);

  if (result.nodesAdded > 0 || result.nodesRemoved > 0) {
    console.log(chalk.blue('\nGraph changes detected:'));
    console.log(`  Nodes: ${chalk.green(`+${result.nodesAdded}`)}, ${chalk.red(`-${result.nodesRemoved}`)}`);
    console.log(`  Edges: ${chalk.green(`+${result.edgesAdded}`)}`);

    const db = initDatabase(getDbPath(rootDir));
    const regen = ora('Regenerating agent context files...').start();
    await generateClaudeMd(rootDir, db);
    generateCursorRules(rootDir, db);
    db.close();
    regen.succeed('Agent config regenerated.');
  } else {
    console.log(chalk.gray(`\nNo significant changes. Skipped ${result.filesSkipped} unchanged files.`));
  }
}
