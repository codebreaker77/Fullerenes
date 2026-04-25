import type { Language, Parser } from '../types.js';
import { TypeScriptParser } from './typescript.js';
import { PythonParser } from './python.js';
import { RustParser } from './rust.js';
import { GoParser } from './go.js';
import { JavaParser } from './java.js';

export { initTreeSitter } from './base.js';

const PARSERS: Record<string, Parser> = {
  typescript: TypeScriptParser,
  javascript: TypeScriptParser,
  python: PythonParser,
  rust: RustParser,
  go: GoParser,
  java: JavaParser,
};

/**
 * Get the appropriate parser for a given language.
 */
export function getParser(language: Language): Parser | null {
  return PARSERS[language] ?? null;
}

export {
  TypeScriptParser,
  PythonParser,
  RustParser,
  GoParser,
  JavaParser,
};
