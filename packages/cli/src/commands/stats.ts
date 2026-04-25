import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { estimateTokenCount, getDbPath, getEntryPoints, getStats, getTopNodes, initDatabase } from 'fullerenes-core';

export function statsCommand(pathStr?: string) {
  const rootDir = pathStr || process.cwd();
  const db = initDatabase(getDbPath(rootDir));

  const stats = getStats(db);
  const topNodes = getTopNodes(db, 20).filter((node) => node.type !== 'module').slice(0, 10);
  const entryPoints = getEntryPoints(db).slice(0, 5);
  db.close();

  console.log(chalk.bgBlue.white.bold(' Fullerenes Knowledge Graph '));
  console.log(`\n${chalk.cyan('Files')}: ${stats.fileCount}`);
  console.log(`${chalk.cyan('Nodes')}: ${stats.nodeCount}`);
  console.log(`${chalk.cyan('Edges')}: ${stats.edgeCount}`);

  const agentsPath = join(rootDir, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    const tokenCost = estimateTokenCount(readFileSync(agentsPath, 'utf8'));
    console.log(`${chalk.cyan('AGENTS.md token cost')}: ${tokenCost}`);
  }

  console.log(chalk.blue('\nLanguage breakdown:'));
  for (const [language, count] of Object.entries(stats.languageBreakdown)) {
    console.log(`  - ${language}: ${count} files`);
  }

  console.log(chalk.blue('\nCore functions and classes:'));
  for (const node of topNodes) {
    console.log(`  - ${chalk.yellow(node.name)} (${node.type}) at ${node.filePath}:${node.lineStart ?? 1} <- ${node.inDegree} incoming edges`);
  }

  console.log(chalk.blue('\nEntry points:'));
  for (const node of entryPoints) {
    console.log(`  - ${chalk.yellow(node.filePath)}:${node.lineStart ?? 1} (${node.outDegree} outgoing edges)`);
  }

  if (stats.lastIndexed) {
    console.log(chalk.gray(`\nLast indexed: ${new Date(stats.lastIndexed).toLocaleString()}`));
  }
}
