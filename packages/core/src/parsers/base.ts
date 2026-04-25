/**
 * Base parser utilities for Fullerenes.
 *
 * Provides shared helpers for all language parsers:
 * - Node ID generation
 * - Content hashing
 * - Tree-sitter initialization (WASM)
 */

import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { NodeRecord, EdgeRecord, ParseResult, Language } from '../types.js';

// web-tree-sitter types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let TreeSitterModule: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadedLanguages = new Map<string, any>();
let requireModule: NodeRequire | null = null;

/**
 * Initialize web-tree-sitter. Must be called once before parsing.
 */
export async function initTreeSitter(): Promise<void> {
  if (TreeSitterModule) return;

  const { createRequire } = await import('node:module');
  requireModule = createRequire(import.meta.url);
  const Parser = requireModule('web-tree-sitter');
  await Parser.init();
  TreeSitterModule = Parser;
}

/**
 * Get a tree-sitter parser initialized with a specific language grammar.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getLanguageParser(wasmName: string): Promise<any> {
  if (!TreeSitterModule) {
    await initTreeSitter();
  }

  if (loadedLanguages.has(wasmName)) {
    const parser = new TreeSitterModule();
    parser.setLanguage(loadedLanguages.get(wasmName));
    return parser;
  }

  // Resolve the WASM file from tree-sitter-wasms package
  const wasmPath = resolveWasmPath(wasmName);
  const wasmBuffer = readFileSync(wasmPath);
  const language = await TreeSitterModule.Language.load(wasmBuffer);
  loadedLanguages.set(wasmName, language);

  const parser = new TreeSitterModule();
  parser.setLanguage(language);
  return parser;
}

/**
 * Resolve the path to a WASM grammar file.
 */
function resolveWasmPath(grammarName: string): string {
  if (!requireModule) {
    throw new Error('tree-sitter runtime not initialized');
  }

  const wasmPkgPath = requireModule.resolve('tree-sitter-wasms/package.json');
  return join(dirname(wasmPkgPath), 'out', `${grammarName}.wasm`);
}

/**
 * Generate a deterministic node ID.
 * Format: "relative/path::type::name"
 */
export function makeNodeId(relativePath: string, type: string, name: string): string {
  // Normalize to forward slashes
  const normalized = relativePath.replace(/\\/g, '/');
  return `${normalized}::${type}::${name}`;
}

/**
 * Get the canonical module node name for a source file.
 */
export function getModuleNodeName(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? normalized;
}

/**
 * Get the canonical module node id for a source file.
 */
export function makeModuleNodeId(relativePath: string): string {
  return makeNodeId(relativePath, 'module', getModuleNodeName(relativePath));
}

/**
 * Generate a deterministic edge ID.
 */
export function makeEdgeId(fromId: string, toId: string, type: string): string {
  return `${fromId}--${type}-->${toId}`;
}

/**
 * Hash content using SHA-256.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Create an empty parse result.
 */
export function emptyParseResult(): ParseResult {
  return { nodes: [], edges: [], errors: [] };
}

/**
 * Safely extract text from a tree-sitter node.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeText(node: any): string {
  try {
    return node?.text ?? '';
  } catch {
    return '';
  }
}

/**
 * Build a NodeRecord with defaults filled in.
 */
export function buildNode(
  relativePath: string,
  opts: {
    type: NodeRecord['type'];
    name: string;
    language: Language;
    lineStart?: number | null;
    lineEnd?: number | null;
    signature?: string | null;
    docstring?: string | null;
    hash?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): NodeRecord {
  return {
    id: makeNodeId(relativePath, opts.type, opts.name),
    type: opts.type,
    name: opts.name,
    file_path: relativePath,
    line_start: opts.lineStart ?? null,
    line_end: opts.lineEnd ?? null,
    signature: opts.signature ?? null,
    docstring: opts.docstring ?? null,
    language: opts.language,
    hash: opts.hash ?? null,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
  };
}

/**
 * Build an EdgeRecord with defaults filled in.
 */
export function buildEdge(
  fromId: string,
  toId: string,
  type: EdgeRecord['type'],
  filePath: string,
  weight = 1.0,
): EdgeRecord {
  return {
    id: makeEdgeId(fromId, toId, type),
    from_id: fromId,
    to_id: toId,
    type,
    weight,
    file_path: filePath,
  };
}
