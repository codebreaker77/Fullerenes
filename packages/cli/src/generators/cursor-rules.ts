import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { getTopNodes, getEntryPoints, getModules } from 'fullerenes-core';

export function generateCursorRules(rootDir: string, db: Database) {
  const topNodes = getTopNodes(db, 10);
  const modules = getModules(db, 5);
  const entryPoints = getEntryPoints(db).slice(0, 5);

  let content = `---
description: Codebase layout and top architectural dependencies
globs: *
alwaysApply: true
---

# Fullerenes Architecture Context

## Core Files You Should Know
`;

  for (const mod of modules) {
    content += `- \`${mod.path}\` (${mod.nodeCount} nodes)\n`;
  }

  content += `\n## Top Functions & Classes\n`;
  for(const node of topNodes) {
     content += `- \`${node.name}\` in \`${node.filePath}\`\n`;
  }

  content += `\n## Main Entry Points\n`;
  for(const ep of entryPoints) {
     content += `- \`${ep.filePath}\`\n`;
  }

  content += `
## Instructions
- When modifying these core dependencies, heavily trace caller graphs before refactoring.
- Run \`npx fullerenes query "<question>"\` to get exact context footprints.
`;

  const rulesDir = join(rootDir, '.cursor', 'rules');
  try {
     mkdirSync(rulesDir, { recursive: true });
     writeFileSync(join(rulesDir, 'fullerenes.mdc'), content.trim() + '\n');
  } catch(e) {
      // Quiet fail if unable to write
  }
}
