import chalk from 'chalk';
import { getDbPath, getEntryPoints, getStats, getTopNodes, initDatabase } from '@fullerenes/core';

export function statsCommand(pathStr?: string) {
  const rootDir = pathStr || process.cwd();
  const db = initDatabase(getDbPath(rootDir));

  const stats = getStats(db);
  const topNodes = getTopNodes(db, 10);
  const entryPoints = getEntryPoints(db).slice(0, 5);
  db.close();

  console.log(chalk.bgBlue.white.bold(' Fullerenes Knowledge Graph '));
  console.log(`\n${chalk.cyan('Files')}: ${stats.fileCount}`);
  console.log(`${chalk.cyan('Nodes')}: ${stats.nodeCount}`);
  console.log(`${chalk.cyan('Edges')}: ${stats.edgeCount}`);

  console.log(chalk.blue('\nLanguage breakdown:'));
  for (const [lang, count] of Object.entries(stats.languageBreakdown)) {
    console.log(`  - ${lang}: ${count} files`);
  }

  console.log(chalk.blue('\nTop nodes by incoming edges:'));
  topNodes.forEach((node) => {
    console.log(`  - ${chalk.yellow(node.name)} (${node.type}) <- ${node.inDegree} incoming edges`);
  });

  console.log(chalk.blue('\nEntry points:'));
  entryPoints.forEach((node) => {
    console.log(`  - ${chalk.yellow(node.filePath)} (${node.outDegree} outgoing edges)`);
  });

  if (stats.lastIndexed) {
    console.log(chalk.gray(`\nLast indexed: ${new Date(stats.lastIndexed).toLocaleString()}`));
  }
}
