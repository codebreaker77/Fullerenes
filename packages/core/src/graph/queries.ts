/**
 * Graph query functions for Fullerenes.
 * Uses better-sqlite3 to query the local knowledge graph.
 */

import type { Database } from 'better-sqlite3';
import type {
  ProjectStats,
  ModuleInfo,
  NodeInfo,
  ImportInfo,
  Subgraph,
  QueryResult,
  EdgeRecord,
} from '../types.js';

export function getStats(db: Database): ProjectStats {
  const fileCount = (db.prepare('SELECT COUNT(*) as count FROM files').get() as any).count;
  const nodeCount = (db.prepare('SELECT COUNT(*) as count FROM nodes').get() as any).count;
  const edgeCount = (db.prepare('SELECT COUNT(*) as count FROM edges').get() as any).count;

  const lastIndexedRow = db.prepare("SELECT value FROM meta WHERE key = 'last_indexed'").get() as any;
  const lastIndexed = lastIndexedRow ? parseInt(lastIndexedRow.value, 10) : null;

  const langRows = db
    .prepare('SELECT language, COUNT(*) as count FROM files GROUP BY language')
    .all() as any[];
  const languageBreakdown: Record<string, number> = {};
  for (const row of langRows) {
    if (row.language) {
      languageBreakdown[row.language] = row.count;
    }
  }

  return { fileCount, nodeCount, edgeCount, languageBreakdown, lastIndexed };
}

export function getModules(db: Database, limit = 50): ModuleInfo[] {
  const rows = db
    .prepare(
      `
        SELECT
          f.path,
          f.language,
          f.node_count AS nodeCount,
          COALESCE(imports.importedByCount, 0) AS importedByCount
        FROM files f
        LEFT JOIN (
          SELECT dst.file_path AS path, COUNT(*) AS importedByCount
          FROM edges e
          JOIN nodes src ON src.id = e.from_id AND src.type = 'module'
          JOIN nodes dst ON dst.id = e.to_id AND dst.type = 'module'
          WHERE e.type = 'imports'
          GROUP BY dst.file_path
        ) imports ON imports.path = f.path
        ORDER BY importedByCount DESC, f.path ASC
        LIMIT ?
      `,
    )
    .all(limit) as any[];

  return rows;
}

export function getTopNodes(db: Database, limit = 20): NodeInfo[] {
  const rows = db
    .prepare(
      `
        SELECT
          n.*,
          (SELECT COUNT(*) FROM edges e WHERE e.to_id = n.id) AS inDegree,
          (SELECT COUNT(*) FROM edges e WHERE e.from_id = n.id) AS outDegree
        FROM nodes n
        ORDER BY inDegree DESC, n.name ASC
        LIMIT ?
      `,
    )
    .all(limit) as any[];

  return rows.map(mapNodeRow);
}

export function getNodesByFile(db: Database, filePath: string): NodeInfo[] {
  const rows = db
    .prepare(
      `
        SELECT
          n.*,
          (SELECT COUNT(*) FROM edges e WHERE e.to_id = n.id) AS inDegree,
          (SELECT COUNT(*) FROM edges e WHERE e.from_id = n.id) AS outDegree
        FROM nodes n
        WHERE file_path = ?
        ORDER BY line_start ASC, name ASC
      `,
    )
    .all(filePath) as any[];

  return rows.map(mapNodeRow);
}

export function getCallers(db: Database, nodeId: string, limit = 10): NodeInfo[] {
  const rows = db
    .prepare(
      `
        SELECT
          n.*,
          (SELECT COUNT(*) FROM edges ex WHERE ex.to_id = n.id) AS inDegree,
          (SELECT COUNT(*) FROM edges ex WHERE ex.from_id = n.id) AS outDegree
        FROM nodes n
        JOIN edges e ON n.id = e.from_id
        WHERE e.to_id = ? AND e.type = 'calls'
        LIMIT ?
      `,
    )
    .all(nodeId, limit) as any[];

  return rows.map(mapNodeRow);
}

export function getCallees(db: Database, nodeId: string, limit = 10): NodeInfo[] {
  const rows = db
    .prepare(
      `
        SELECT
          n.*,
          (SELECT COUNT(*) FROM edges ex WHERE ex.to_id = n.id) AS inDegree,
          (SELECT COUNT(*) FROM edges ex WHERE ex.from_id = n.id) AS outDegree
        FROM nodes n
        JOIN edges e ON n.id = e.to_id
        WHERE e.from_id = ? AND e.type = 'calls'
        LIMIT ?
      `,
    )
    .all(nodeId, limit) as any[];

  return rows.map(mapNodeRow);
}

export function getImports(db: Database, filePath: string): ImportInfo[] {
  const rows = db
    .prepare(
      `
        SELECT
          e.to_id AS toId,
          dst.id AS resolvedNodeId,
          dst.file_path AS resolvedPath
        FROM edges e
        JOIN nodes src ON src.id = e.from_id AND src.type = 'module'
        LEFT JOIN nodes dst ON dst.id = e.to_id AND dst.type = 'module'
        WHERE e.type = 'imports' AND src.file_path = ?
        ORDER BY COALESCE(dst.file_path, e.to_id) ASC
      `,
    )
    .all(filePath) as Array<{ toId: string; resolvedNodeId: string | null; resolvedPath: string | null }>;

  return rows.map((row) => ({
    source: row.resolvedPath ?? extractPathFromNodeId(row.toId),
    specifiers: [],
    resolvedNodeId: row.resolvedNodeId,
  }));
}

export function getImportedBy(db: Database, filePath: string): string[] {
  const rows = db
    .prepare(
      `
        SELECT DISTINCT src.file_path AS filePath
        FROM edges e
        JOIN nodes src ON src.id = e.from_id AND src.type = 'module'
        JOIN nodes dst ON dst.id = e.to_id AND dst.type = 'module'
        WHERE e.type = 'imports' AND dst.file_path = ?
        ORDER BY src.file_path ASC
      `,
    )
    .all(filePath) as Array<{ filePath: string }>;

  return rows.map((row) => row.filePath);
}

export function searchNodes(db: Database, query: string, limit = 10): NodeInfo[] {
  const searchTerm = `%${query}%`;
  const rows = db
    .prepare(
      `
        SELECT
          n.*,
          (SELECT COUNT(*) FROM edges e WHERE e.to_id = n.id) AS inDegree,
          (SELECT COUNT(*) FROM edges e WHERE e.from_id = n.id) AS outDegree
        FROM nodes n
        WHERE LOWER(n.name) LIKE LOWER(?) OR LOWER(COALESCE(n.signature, '')) LIKE LOWER(?)
        ORDER BY inDegree DESC, n.name ASC
        LIMIT ?
      `,
    )
    .all(searchTerm, searchTerm, limit) as any[];

  return rows.map(mapNodeRow);
}

export function getSubgraph(db: Database, nodeId: string, depth = 2, maxNodes = 50): Subgraph {
  const nodes = new Map<string, NodeInfo>();
  const edges: EdgeRecord[] = [];
  const queue = [{ id: nodeId, currentDepth: 0 }];
  const visited = new Set<string>();

  const rootNode = getNodeById(db, nodeId);
  if (rootNode) {
    nodes.set(nodeId, rootNode);
  }

  while (queue.length > 0 && nodes.size < maxNodes) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    if (visited.has(current.id)) {
      continue;
    }
    visited.add(current.id);

    if (current.currentDepth >= depth) {
      continue;
    }

    const relatedEdges = db
      .prepare('SELECT * FROM edges WHERE from_id = ? OR to_id = ? ORDER BY weight DESC, id ASC')
      .all(current.id, current.id) as EdgeRecord[];

    for (const edge of relatedEdges) {
      edges.push(edge);
      const neighborId = edge.from_id === current.id ? edge.to_id : edge.from_id;
      if (nodes.has(neighborId)) {
        continue;
      }

      const neighborNode = getNodeById(db, neighborId);
      if (!neighborNode) {
        continue;
      }

      nodes.set(neighborId, neighborNode);
      if (nodes.size >= maxNodes) {
        break;
      }

      queue.push({ id: neighborId, currentDepth: current.currentDepth + 1 });
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(new Map(edges.map((edge) => [edge.id, edge])).values()),
  };
}

export function getEntryPoints(db: Database): NodeInfo[] {
  const rows = db
    .prepare(
      `
        SELECT
          n.*,
          (
            SELECT COUNT(*)
            FROM edges incoming
            WHERE incoming.to_id = n.id AND incoming.type = 'imports'
          ) AS inDegree,
          (
            SELECT COUNT(*)
            FROM edges outgoing
            WHERE outgoing.from_id = n.id AND outgoing.type = 'imports'
          ) AS outDegree
        FROM nodes n
        WHERE n.type = 'module'
          AND (
            SELECT COUNT(*)
            FROM edges incoming
            WHERE incoming.to_id = n.id AND incoming.type = 'imports'
          ) = 0
        ORDER BY outDegree DESC, n.file_path ASC
        LIMIT 20
      `,
    )
    .all() as any[];

  return rows.map(mapNodeRow);
}

export function detectCircularDeps(db: Database): string[][] {
  const edges = db
    .prepare(
      `
        SELECT src.file_path AS fromPath, dst.file_path AS toPath
        FROM edges e
        JOIN nodes src ON src.id = e.from_id AND src.type = 'module'
        JOIN nodes dst ON dst.id = e.to_id AND dst.type = 'module'
        WHERE e.type = 'imports'
      `,
    )
    .all() as Array<{ fromPath: string; toPath: string }>;

  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    const next = graph.get(edge.fromPath) ?? [];
    next.push(edge.toPath);
    graph.set(edge.fromPath, next);
    if (!graph.has(edge.toPath)) {
      graph.set(edge.toPath, []);
    }
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const cycles = new Map<string, string[]>();

  const visit = (node: string, path: string[]) => {
    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const neighbor of graph.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        visit(neighbor, path);
        continue;
      }

      if (stack.has(neighbor)) {
        const startIndex = path.indexOf(neighbor);
        if (startIndex >= 0) {
          const cycle = path.slice(startIndex);
          const key = canonicalizeCycle(cycle);
          cycles.set(key, cycle);
        }
      }
    }

    path.pop();
    stack.delete(node);
  };

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      visit(node, []);
    }
  }

  return Array.from(cycles.values());
}

export function queryWithBudget(db: Database, question: string, maxTokens = 2000): QueryResult {
  const identifierPattern =
    /\b(?:[a-z]+_[a-z0-9_]+|[a-z]+(?:[A-Z][a-z0-9]+)+|[A-Z][a-zA-Z0-9]+)\b/g;
  const fallbackPattern = /\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g;
  const matches = question.match(identifierPattern) ?? question.match(fallbackPattern) ?? [];
  const identifiers = Array.from(new Set(matches));

  const mergedNodes = new Map<string, NodeInfo>();
  for (const identifier of identifiers) {
    const searchResults = searchNodes(db, identifier, 3);
    for (const node of searchResults) {
      if (mergedNodes.has(node.id)) {
        continue;
      }

      const subgraph = getSubgraph(db, node.id, 1, 10);
      for (const subgraphNode of subgraph.nodes) {
        mergedNodes.set(subgraphNode.id, subgraphNode);
      }
    }
  }

  const maxChars = maxTokens * 4;
  let text = '';
  let truncated = false;

  for (const node of mergedNodes.values()) {
    const entry =
      `\n--- ${node.name} (${node.type}) in ${node.filePath}:${node.lineStart ?? '?'} ---\n` +
      `${node.signature ? `Signature: ${node.signature}\n` : ''}` +
      `${node.docstring ? `Doc: ${node.docstring}\n` : ''}`;

    if (text.length + entry.length > maxChars) {
      truncated = true;
      break;
    }

    text += entry;
  }

  if (!text) {
    text = 'No relevant context found in codebase.';
  }

  return {
    text: text.trim(),
    nodeCount: mergedNodes.size,
    truncated,
  };
}

function canonicalizeCycle(cycle: string[]): string {
  const variants = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)]);
  return variants
    .map((variant) => variant.join('->'))
    .sort((left, right) => left.localeCompare(right))[0]!;
}

function extractPathFromNodeId(nodeId: string): string {
  const separatorIndex = nodeId.indexOf('::');
  return separatorIndex >= 0 ? nodeId.slice(0, separatorIndex) : nodeId;
}

function getNodeById(db: Database, nodeId: string): NodeInfo | null {
  const row = db
    .prepare(
      `
        SELECT
          n.*,
          (SELECT COUNT(*) FROM edges e WHERE e.to_id = n.id) AS inDegree,
          (SELECT COUNT(*) FROM edges e WHERE e.from_id = n.id) AS outDegree
        FROM nodes n
        WHERE id = ?
      `,
    )
    .get(nodeId) as any;

  return row ? mapNodeRow(row) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapNodeRow(row: any): NodeInfo {
  return {
    id: row.id,
    name: row.name,
    type: row.type as NodeInfo['type'],
    filePath: row.file_path,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    signature: row.signature,
    docstring: row.docstring,
    language: row.language as NodeInfo['language'],
    inDegree: row.inDegree ?? 0,
    outDegree: row.outDegree ?? 0,
  };
}
