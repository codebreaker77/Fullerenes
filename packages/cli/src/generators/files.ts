import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GENERATED_START = '<!-- BEGIN FULLERENES -->';
const GENERATED_END = '<!-- END FULLERENES -->';

export function writeGeneratedMarkdownFile(
  rootDir: string,
  fileName: 'CLAUDE.md' | 'AGENTS.md',
  generatedContent: string,
): void {
  const targetPath = join(rootDir, fileName);
  const managedBlock = `${GENERATED_START}\n${generatedContent.trim()}\n${GENERATED_END}\n`;

  if (!existsSync(targetPath)) {
    writeFileSync(targetPath, managedBlock);
    return;
  }

  const existing = readFileSync(targetPath, 'utf-8');
  const startIndex = existing.indexOf(GENERATED_START);
  const endIndex = existing.indexOf(GENERATED_END);

  if (startIndex >= 0 && endIndex >= startIndex) {
    const before = existing.slice(0, startIndex).trimEnd();
    const after = existing.slice(endIndex + GENERATED_END.length).trimStart();
    const merged = [before, managedBlock.trimEnd(), after].filter(Boolean).join('\n\n') + '\n';
    writeFileSync(targetPath, merged);
    return;
  }

  const separator = existing.trimEnd() ? '\n\n' : '';
  writeFileSync(targetPath, `${existing.trimEnd()}${separator}${managedBlock}`);
}

export function getGeneratedMarkers() {
  return {
    start: GENERATED_START,
    end: GENERATED_END,
  };
}
