/**
 * Shared type definitions for the Fullerenes core package.
 */

export type NodeType =
  | 'function'
  | 'class'
  | 'module'
  | 'variable'
  | 'interface'
  | 'type';

export type EdgeType =
  | 'calls'
  | 'imports'
  | 'inherits'
  | 'implements'
  | 'contains'
  | 'references';

export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java';

export interface NodeRecord {
  id: string;
  type: NodeType;
  name: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  signature: string | null;
  docstring: string | null;
  language: Language;
  hash: string | null;
  metadata: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface EdgeRecord {
  id: string;
  from_id: string;
  to_id: string;
  type: EdgeType;
  weight: number;
  file_path: string;
  created_at?: number;
}

export interface FileRecord {
  path: string;
  hash: string | null;
  language: Language | null;
  size_bytes: number | null;
  node_count: number | null;
  last_indexed: number | null;
}

export interface ParseResult {
  nodes: NodeRecord[];
  edges: EdgeRecord[];
  errors: ParseError[];
}

export interface ParseError {
  file: string;
  line: number | null;
  message: string;
}

export interface Parser {
  language: Language;
  extensions: string[];
  parse(filePath: string, content: string): Promise<ParseResult>;
}

export interface WalkOptions {
  extensions?: string[];
  maxFileSize?: number;
  respectGitignore?: boolean;
}

export interface FileInfo {
  path: string;
  relativePath: string;
  language: Language;
  sizeBytes: number;
}

export interface ProjectStats {
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  languageBreakdown: Record<string, number>;
  lastIndexed: number | null;
}

export interface NodeInfo {
  id: string;
  name: string;
  type: NodeType;
  filePath: string;
  lineStart: number | null;
  lineEnd: number | null;
  signature: string | null;
  docstring: string | null;
  language: Language;
  inDegree: number;
  outDegree: number;
}

export interface ModuleInfo {
  path: string;
  language: Language | null;
  nodeCount: number;
  importedByCount: number;
}

export interface ImportInfo {
  source: string;
  specifiers: string[];
  resolvedNodeId: string | null;
}

export interface Subgraph {
  nodes: NodeInfo[];
  edges: EdgeRecord[];
}

export interface QuerySection {
  title: string;
  lines: string[];
}

export interface QueryResult {
  text: string;
  nodeCount: number;
  truncated: boolean;
  estimatedTokens: number;
  sections: QuerySection[];
}

export interface ImpactNode {
  id: string;
  name: string;
  type: NodeType;
  filePath: string;
  lineStart: number | null;
  depth: number;
  via: EdgeType[];
}

export interface ImpactResult {
  target: NodeInfo;
  directDependents: ImpactNode[];
  transitiveDependents: ImpactNode[];
  totalDependents: number;
  uniqueFiles: string[];
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
}

export interface IndexOptions {
  incremental?: boolean;
  concurrency?: number;
  onProgress?: (current: number, total: number, file: string) => void;
  onError?: (file: string, error: Error) => void;
}

export interface IndexResult {
  filesIndexed: number;
  filesSkipped: number;
  nodesAdded: number;
  nodesRemoved: number;
  edgesAdded: number;
  durationMs: number;
  errors: ParseError[];
}

export const EXTENSION_MAP: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
};

export const DEFAULT_EXTENSIONS = Object.keys(EXTENSION_MAP);

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.fullerenes',
  'coverage',
  '.turbo',
  '.idea',
  '.vscode',
]);

export const DEFAULT_MAX_FILE_SIZE = 500 * 1024;
