/**
 * SQLite database schema and initialization for Fullerenes.
 *
 * Creates the local knowledge graph database at .fullerenes/graph.db
 * Tables: nodes, edges, files, meta
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA_SQL = `
-- Nodes: functions, classes, modules, variables, interfaces, types
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_start INTEGER,
  line_end INTEGER,
  signature TEXT,
  docstring TEXT,
  language TEXT NOT NULL,
  hash TEXT,
  metadata TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Edges: calls, imports, inherits, implements, contains, references
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  file_path TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Files: tracked source files with hashes for incremental indexing
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  hash TEXT,
  language TEXT,
  size_bytes INTEGER,
  node_count INTEGER,
  last_indexed INTEGER
);

-- Meta: key-value store for project-level metadata
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
`;

/**
 * Open or create a SQLite database at the given path.
 * Creates parent directories if they don't exist.
 * Applies schema migrations.
 */
export function initDatabase(dbPath: string): Database.Database {
  // Ensure directory exists
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('busy_timeout = 5000');

  // Apply schema
  db.exec(SCHEMA_SQL);

  return db;
}

/**
 * Close the database safely.
 */
export function closeDatabase(db: Database.Database): void {
  try {
    db.close();
  } catch {
    // Already closed or invalid — ignore
  }
}

/**
 * Get the default database path for a project root.
 */
export function getDbPath(rootDir: string): string {
  return `${rootDir}/.fullerenes/graph.db`;
}

/**
 * Set a meta key-value pair.
 */
export function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

/**
 * Get a meta value by key.
 */
export function getMeta(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}
