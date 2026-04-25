import type { Database } from 'better-sqlite3';
import type {
  EdgeRecord,
  ImpactNode,
  ImpactResult,
  ImportInfo,
  ModuleInfo,
  NodeInfo,
  ProjectStats,
  QueryResult,
  QuerySection,
  Subgraph,
} from '../types.js';

export function getStats(db: Database): ProjectStats {
  const fileCount = getCount(db, 'SELECT COUNT(*) AS count FROM files');
  const nodeCount = getCount(db, 'SELECT COUNT(*) AS count FROM nodes');
  const edgeCount = getCount(db, 'SELECT COUNT(*) AS count FROM edges');

  const lastIndexedRow = db.prepare("SELECT value FROM meta WHERE key = 'last_indexed'").get() as
    | { value: string }
    | undefined;
  const lastIndexed = lastIndexedRow ? Number.parseInt(lastIndexedRow.value, 10) : null;

  const languageBreakdown: Record<string, number> = {};
  const langRows = db
    .prepare('SELECT language, COUNT(*) AS count FROM files GROUP BY language ORDER BY count DESC')
    .all() as Array<{ language: string | null; count: number }>;

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
    .all(limit) as ModuleInfo[];

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
    .all(limit) as unknown[];

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
    .all(filePath) as unknown[];

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
        ORDER BY n.file_path ASC, n.line_start ASC, n.name ASC
        LIMIT ?
      `,
    )
    .all(nodeId, limit) as unknown[];

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
        ORDER BY n.file_path ASC, n.line_start ASC, n.name ASC
        LIMIT ?
      `,
    )
    .all(nodeId, limit) as unknown[];

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
        ORDER BY
          CASE WHEN LOWER(n.name) = LOWER(?) THEN 0 ELSE 1 END,
          inDegree DESC,
          n.name ASC
        LIMIT ?
      `,
    )
    .all(searchTerm, searchTerm, query, limit) as unknown[];

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
    if (!current || visited.has(current.id)) {
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

      const neighbor = getNodeById(db, neighborId);
      if (!neighbor) {
        continue;
      }

      nodes.set(neighborId, neighbor);
      if (nodes.size >= maxNodes) {
        break;
      }

      queue.push({ id: neighborId, currentDepth: current.currentDepth + 1 });
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: dedupeEdges(edges),
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
    .all() as unknown[];

  return rows.map(mapNodeRow);
}

export function detectCircularDeps(db: Database): string[][] {
  const rows = db
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
  for (const row of rows) {
    const next = graph.get(row.fromPath) ?? [];
    next.push(row.toPath);
    graph.set(row.fromPath, next);
    if (!graph.has(row.toPath)) {
      graph.set(row.toPath, []);
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
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart >= 0) {
          const cycle = path.slice(cycleStart);
          cycles.set(canonicalizeCycle(cycle), cycle);
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

export function predictImpact(db: Database, nodeId: string, maxDepth = 3, limit = 50): ImpactResult | null {
  const target = getNodeById(db, nodeId);
  if (!target) {
    return null;
  }

  const incomingEdges = new Map<string, EdgeRecord[]>();
  const queue = [{ id: nodeId, depth: 0 }];
  const seen = new Set<string>([nodeId]);
  const dependents: ImpactNode[] = [];

  while (queue.length > 0 && dependents.length < limit) {
    const current = queue.shift();
    if (!current || current.depth >= maxDepth) {
      continue;
    }

    const edges = getIncomingDependencyEdges(db, current.id, incomingEdges);
    for (const edge of edges) {
      if (seen.has(edge.from_id)) {
        continue;
      }

      const node = getNodeById(db, edge.from_id);
      if (!node) {
        continue;
      }

      seen.add(node.id);
      const impactNode: ImpactNode = {
        id: node.id,
        name: node.name,
        type: node.type,
        filePath: node.filePath,
        lineStart: node.lineStart,
        depth: current.depth + 1,
        via: [edge.type],
      };
      dependents.push(impactNode);
      queue.push({ id: node.id, depth: current.depth + 1 });
    }
  }

  const directDependents = dependents.filter((node) => node.depth === 1);
  const uniqueFiles = Array.from(new Set(dependents.map((node) => node.filePath))).sort((a, b) =>
    a.localeCompare(b),
  );
  const risk = scoreImpactRisk(directDependents.length, uniqueFiles.length, dependents.length);
  const summary = `${directDependents.length} direct dependents across ${uniqueFiles.length} file${
    uniqueFiles.length === 1 ? '' : 's'
  } - Risk: ${risk}`;

  return {
    target,
    directDependents,
    transitiveDependents: dependents,
    totalDependents: dependents.length,
    uniqueFiles,
    risk,
    summary,
  };
}

export function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function queryWithBudget(db: Database, question: string, maxTokens = 2000): QueryResult {
  const identifierPattern =
    /\b(?:[a-z]+_[a-z0-9_]+|[a-z]+(?:[A-Z][a-z0-9]+)+|[A-Z][a-zA-Z0-9]+)\b/g;
  const fallbackPattern = /\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g;
  const matches = question.match(identifierPattern) ?? question.match(fallbackPattern) ?? [];
  const identifiers = Array.from(new Set(matches));

  const matchedNodes = new Map<string, NodeInfo>();
  const relatedNodes = new Map<string, NodeInfo>();
  const relatedFiles = new Set<string>();

  for (const identifier of identifiers) {
    const results = searchNodes(db, identifier, 3);
    for (const node of results) {
      matchedNodes.set(node.id, node);
      const subgraph = getSubgraph(db, node.id, 1, 12);
      for (const subgraphNode of subgraph.nodes) {
        relatedNodes.set(subgraphNode.id, subgraphNode);
        relatedFiles.add(subgraphNode.filePath);
      }
    }
  }

  if (matchedNodes.size === 0) {
    const fallback = 'No relevant context found in the indexed graph.';
    return {
      text: fallback,
      nodeCount: 0,
      truncated: false,
      estimatedTokens: estimateTokenCount(fallback),
      sections: [{ title: 'No Matches', lines: [fallback] }],
    };
  }

  const matchedList = Array.from(matchedNodes.values()).sort(sortNodesByImportance);
  const relatedList = Array.from(relatedNodes.values()).sort(sortNodesByImportance);
  const entryPoints = getEntryPoints(db).filter((node) => relatedFiles.has(node.filePath)).slice(0, 5);

  const sections: QuerySection[] = [];

  if (entryPoints.length) {
    sections.push({
      title: 'ENTRY POINTS',
      lines: entryPoints.map((node) => formatNodeLocation(node, `${node.outDegree} outgoing imports`)),
    });
  }

  sections.push({
    title: 'CORE NODES',
    lines: matchedList.map((node) => {
      const signature = node.signature ? ` - ${node.signature}` : '';
      return `${formatNodeLocation(node, node.type)}${signature}`;
    }),
  });

  const callerLines = matchedList.flatMap((node) => {
    const callers = getCallers(db, node.id, 5);
    if (!callers.length) {
      return [`${node.name}: no indexed callers`];
    }

    return [`${node.name}: ${callers.map((caller) => formatNodeLocation(caller)).join(', ')}`];
  });
  sections.push({
    title: 'CALLERS',
    lines: callerLines,
  });

  const signatureLines = matchedList
    .filter((node) => node.signature || node.docstring)
    .map((node) => {
      const pieces = [];
      if (node.signature) {
        pieces.push(node.signature);
      }
      if (node.docstring) {
        pieces.push(node.docstring);
      }
      return `${node.name}: ${pieces.join(' | ')}`;
    });
  if (signatureLines.length) {
    sections.push({
      title: 'SIGNATURES',
      lines: signatureLines,
    });
  }

  sections.push({
    title: 'RELATED FILES',
    lines: Array.from(relatedFiles)
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 10),
  });

  if (relatedList.length > matchedList.length) {
    const relatedNodeLines = relatedList
      .filter((node) => !matchedNodes.has(node.id))
      .slice(0, 8)
      .map((node) => formatNodeLocation(node, node.type));
    if (relatedNodeLines.length) {
      sections.push({
        title: 'RELATED NODES',
        lines: relatedNodeLines,
      });
    }
  }

  const maxChars = maxTokens * 4;
  let text = '';
  const keptSections: QuerySection[] = [];
  let truncated = false;

  for (const section of sections) {
    const block = `## ${section.title}\n${section.lines.map((line) => `- ${line}`).join('\n')}\n\n`;
    if (text.length + block.length > maxChars) {
      truncated = true;
      break;
    }

    keptSections.push(section);
    text += block;
  }

  const finalText = text.trim() || 'No relevant context found in the indexed graph.';
  return {
    text: finalText,
    nodeCount: matchedNodes.size,
    truncated,
    estimatedTokens: estimateTokenCount(finalText),
    sections: keptSections,
  };
}

export function getNodeById(db: Database, nodeId: string): NodeInfo | null {
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
    .get(nodeId) as unknown;

  return row ? mapNodeRow(row) : null;
}

function getIncomingDependencyEdges(
  db: Database,
  nodeId: string,
  cache: Map<string, EdgeRecord[]>,
): EdgeRecord[] {
  if (!cache.has(nodeId)) {
    const rows = db
      .prepare(
        `
          SELECT *
          FROM edges
          WHERE to_id = ?
            AND type IN ('calls', 'imports', 'inherits', 'implements', 'references')
          ORDER BY weight DESC, id ASC
        `,
      )
      .all(nodeId) as EdgeRecord[];
    cache.set(nodeId, rows);
  }

  return cache.get(nodeId) ?? [];
}

function scoreImpactRisk(directDependents: number, uniqueFiles: number, totalDependents: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (directDependents >= 5 || uniqueFiles >= 4 || totalDependents >= 10) {
    return 'HIGH';
  }
  if (directDependents >= 2 || uniqueFiles >= 2 || totalDependents >= 4) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function sortNodesByImportance(left: NodeInfo, right: NodeInfo): number {
  return right.inDegree - left.inDegree || left.filePath.localeCompare(right.filePath) || left.name.localeCompare(right.name);
}

function formatNodeLocation(node: NodeInfo, suffix?: string): string {
  const location = `${node.filePath}:${node.lineStart ?? 1}`;
  return suffix ? `${node.name} (${location}) - ${suffix}` : `${node.name} (${location})`;
}

function canonicalizeCycle(cycle: string[]): string {
  const variants = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)]);
  return variants.map((variant) => variant.join('->')).sort((left, right) => left.localeCompare(right))[0]!;
}

function extractPathFromNodeId(nodeId: string): string {
  const separatorIndex = nodeId.indexOf('::');
  return separatorIndex >= 0 ? nodeId.slice(0, separatorIndex) : nodeId;
}

function dedupeEdges(edges: EdgeRecord[]): EdgeRecord[] {
  return Array.from(new Map(edges.map((edge) => [edge.id, edge])).values());
}

function getCount(db: Database, query: string): number {
  return (db.prepare(query).get() as { count: number }).count;
}

function mapNodeRow(row: unknown): NodeInfo {
  const value = row as Record<string, unknown>;
  return {
    id: value.id as string,
    name: value.name as string,
    type: value.type as NodeInfo['type'],
    filePath: value.file_path as string,
    lineStart: (value.line_start as number | null) ?? null,
    lineEnd: (value.line_end as number | null) ?? null,
    signature: (value.signature as string | null) ?? null,
    docstring: (value.docstring as string | null) ?? null,
    language: value.language as NodeInfo['language'],
    inDegree: (value.inDegree as number | null) ?? 0,
    outDegree: (value.outDegree as number | null) ?? 0,
  };
}
