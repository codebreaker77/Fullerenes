/**
 * File walker for Fullerenes.
 *
 * Walks a project directory, respects .gitignore, skips known junk dirs,
 * and yields FileInfo for each source file.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import ignore from 'ignore';
import type { FileInfo, Language, WalkOptions } from '../types.js';
import {
  EXTENSION_MAP,
  DEFAULT_EXTENSIONS,
  DEFAULT_MAX_FILE_SIZE,
  SKIP_DIRS,
} from '../types.js';

export type IgnoreMatcher = (targetPath: string, isDirectory?: boolean) => boolean;

/**
 * Walk a project directory and yield source files.
 *
 * Respects .gitignore, skips known directories (node_modules, .git, dist, etc.),
 * and filters by extension and file size.
 */
export async function* walkProject(
  rootDir: string,
  options?: WalkOptions,
): AsyncGenerator<FileInfo> {
  const extensions = new Set(options?.extensions ?? DEFAULT_EXTENSIONS);
  const maxFileSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const respectGitignore = options?.respectGitignore ?? true;
  const isIgnored = createProjectIgnoreMatcher(rootDir, respectGitignore);

  yield* walkDir(rootDir, rootDir, extensions, maxFileSize, isIgnored);
}

export function createProjectIgnoreMatcher(
  rootDir: string,
  respectGitignore = true,
): IgnoreMatcher {
  const ig = (
    ignore as unknown as () => {
      ignores: (path: string) => boolean;
      add: (patterns: string) => void;
    }
  )();
  if (respectGitignore) {
    try {
      const gitignoreContent = readFileSync(join(rootDir, '.gitignore'), 'utf-8');
      ig.add(gitignoreContent);
    } catch {
      // No .gitignore — that's fine
    }
  }

  return (targetPath: string, isDirectory = false): boolean => {
    const relPath = relative(rootDir, targetPath).replace(/\\/g, '/');
    if (!relPath || relPath === '.') {
      return false;
    }

    const segments = relPath.split('/');
    if (segments.some((segment) => SKIP_DIRS.has(segment))) {
      return true;
    }

    return ig.ignores(isDirectory ? `${relPath}/` : relPath);
  };
}

function* walkDir(
  dir: string,
  rootDir: string,
  extensions: Set<string>,
  maxFileSize: number,
  isIgnored: IgnoreMatcher,
): Generator<FileInfo> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Permission denied or invalid dir — skip
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');

    // Skip known junk directories
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (isIgnored(fullPath, true)) continue;

      yield* walkDir(fullPath, rootDir, extensions, maxFileSize, isIgnored);
      continue;
    }

    // Files
    if (!entry.isFile()) continue;

    // Check gitignore
    if (isIgnored(fullPath)) continue;

    // Check extension
    const ext = extname(entry.name).toLowerCase();
    if (!extensions.has(ext)) continue;

    // Check file size
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.size > maxFileSize) continue;

    // Determine language
    const language = EXTENSION_MAP[ext];
    if (!language) continue;

    yield {
      path: fullPath,
      relativePath: relPath,
      language: language as Language,
      sizeBytes: stat.size,
    };
  }
}

/**
 * Detect the language of a file by its extension.
 */
export function detectLanguage(filePath: string): Language | null {
  const ext = extname(filePath).toLowerCase();
  return (EXTENSION_MAP[ext] as Language) ?? null;
}
