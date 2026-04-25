import chalk from 'chalk';
import { getDbPath, initDatabase, queryWithBudget } from 'fullerenes-core';

export async function queryCommand(question: string, options: { budget?: number; json?: boolean }) {
  const rootDir = process.cwd();
  const db = initDatabase(getDbPath(rootDir));
  const maxTokens = options.budget ? Number(options.budget) : 2000;
  const result = queryWithBudget(db, question, maxTokens);
  db.close();

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`${chalk.blue('Fullerenes')} query result\n`);
  console.log(result.text);
  console.log(chalk.gray('\n----------------------------------------'));
  console.log(`Matched nodes: ${chalk.cyan(result.nodeCount)}`);
  console.log(`Estimated tokens: ${chalk.cyan(result.estimatedTokens)}`);
  console.log(`Truncated early: ${result.truncated ? chalk.red('Yes') : chalk.green('No')}`);
}
