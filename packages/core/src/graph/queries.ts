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
        WHERE
          LOWER(n.name) LIKE LOWER(?)
          OR LOWER(COALESCE(n.signature, '')) LIKE LOWER(?)
          OR LOWER(COALESCE(n.docstring, '')) LIKE LOWER(?)
          OR LOWER(n.file_path) LIKE LOWER(?)
        ORDER BY
          CASE WHEN LOWER(n.name) = LOWER(?) THEN 0 ELSE 1 END,
          CASE WHEN LOWER(n.name) LIKE LOWER(?) THEN 0 ELSE 1 END,
          CASE WHEN LOWER(n.file_path) LIKE LOWER(?) THEN 0 ELSE 1 END,
          inDegree DESC,
          n.name ASC
        LIMIT ?
      `,
    )
    .all(searchTerm, searchTerm, searchTerm, searchTerm, query, `${query}%`, searchTerm, limit) as unknown[];

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
  const terms = extractSearchTerms(question);
  const intent = inferQueryIntent(question);
  const rankedMatches = rankNodesForQuestion(db, question, terms);

  if (rankedMatches.length === 0) {
    const fallback = 'No relevant context found in the indexed graph.';
    return {
      text: fallback,
      nodeCount: 0,
      truncated: false,
      estimatedTokens: estimateTokenCount(fallback),
      sections: [{ title: 'NO MATCHES', lines: [fallback] }],
    };
  }

  const coreNodes = rankedMatches.slice(0, getCoreNodeLimit(intent)).map((match) => match.node);
  const coreNodeIds = new Set(coreNodes.map((node) => node.id));
  const relatedNodes = new Map<string, NodeInfo>();
  const relatedFiles = new Set<string>();

  for (const node of coreNodes) {
    relatedFiles.add(node.filePath);
    const subgraph = getSubgraph(db, node.id, 1, 10);
    for (const subgraphNode of subgraph.nodes) {
      relatedNodes.set(subgraphNode.id, subgraphNode);
      relatedFiles.add(subgraphNode.filePath);
    }
  }

  const matchedFiles = searchFiles(db, terms, 6);
  for (const filePath of matchedFiles) {
    relatedFiles.add(filePath);
  }

  const entryPoints = getEntryPoints(db)
    .filter((node) => relatedFiles.has(node.filePath))
    .slice(0, intent === 'entrypoints' ? 5 : 3);

  const sections = buildQuerySections(db, intent, coreNodes, relatedNodes, relatedFiles, entryPoints);

  const maxChars = Math.max(400, maxTokens * 4);
  let text = '';
  const keptSections: QuerySection[] = [];
  let truncated = false;

  for (const section of sections) {
    if (section.lines.length === 0) {
      continue;
    }

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
    nodeCount: coreNodeIds.size,
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

type QueryIntent = 'entrypoints' | 'impact' | 'implementation' | 'overview';

interface RankedNodeMatch {
  node: NodeInfo;
  score: number;
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

function sanitizeInlineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractSearchTerms(question: string): string[] {
  const normalized = question
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_/.-]+/g, ' ')
    .toLowerCase();
  const rawTerms = normalized.match(/\b[a-z][a-z0-9]{1,}\b/g) ?? [];
  const terms = new Set<string>();

  for (const term of rawTerms) {
    if (STOP_WORDS.has(term)) {
      continue;
    }
    if (term.length >= 3 || IMPORTANT_SHORT_TERMS.has(term)) {
      terms.add(term);
    }
  }

  for (const term of Array.from(terms)) {
    for (const expansion of TERM_EXPANSIONS[term] ?? []) {
      terms.add(expansion);
    }
  }

  return Array.from(terms).slice(0, 12);
}

function inferQueryIntent(question: string): QueryIntent {
  const lower = question.toLowerCase();
  if (
    lower.includes('entry point') ||
    lower.includes('where does') ||
    lower.includes('where is') ||
    lower.includes('start') ||
    lower.includes('flow')
  ) {
    return 'entrypoints';
  }
  if (
    lower.includes('impact') ||
    lower.includes('safe to change') ||
    lower.includes('risk') ||
    lower.includes('depend')
  ) {
    return 'impact';
  }
  if (
    lower.includes('what does') ||
    lower.includes('how does') ||
    lower.includes('implementation') ||
    lower.includes('logic')
  ) {
    return 'implementation';
  }
  return 'overview';
}

function rankNodesForQuestion(db: Database, question: string, terms: string[]): RankedNodeMatch[] {
  const candidateMap = new Map<string, RankedNodeMatch>();
  const searchInputs = [question, ...terms];

  for (const input of searchInputs) {
    const results = searchNodes(db, input, input === question ? 8 : 6);
    for (const node of results) {
      if (node.type === 'module') {
        continue;
      }

      const score = scoreNodeMatch(node, question, terms);
      const existing = candidateMap.get(node.id);
      if (!existing || score > existing.score) {
        candidateMap.set(node.id, { node, score });
      }
    }
  }

  return Array.from(candidateMap.values())
    .sort((left, right) => right.score - left.score || sortNodesByImportance(left.node, right.node))
    .slice(0, 12);
}

function getCoreNodeLimit(intent: QueryIntent): number {
  switch (intent) {
    case 'entrypoints':
      return 4;
    case 'impact':
      return 4;
    case 'implementation':
      return 5;
    case 'overview':
    default:
      return 4;
  }
}

function scoreNodeMatch(node: NodeInfo, question: string, terms: string[]): number {
  const lowerName = node.name.toLowerCase();
  const lowerSignature = (node.signature ?? '').toLowerCase();
  const lowerDocstring = (node.docstring ?? '').toLowerCase();
  const lowerPath = node.filePath.toLowerCase();
  const lowerQuestion = question.toLowerCase();

  let score = Math.min(node.inDegree, 8) * 0.5 + Math.min(node.outDegree, 6) * 0.2;

  if (lowerName === lowerQuestion) {
    score += 30;
  }
  if (lowerPath.includes(lowerQuestion) || lowerSignature.includes(lowerQuestion)) {
    score += 14;
  }

  for (const term of terms) {
    if (lowerName === term) {
      score += 18;
    } else if (lowerName.startsWith(term)) {
      score += 12;
    } else if (lowerName.includes(term)) {
      score += 8;
    }

    if (lowerSignature.includes(term)) {
      score += 5;
    }
    if (lowerDocstring.includes(term)) {
      score += 4;
    }
    if (lowerPath.includes(term)) {
      score += 6;
    }
  }

  return score;
}

function searchFiles(db: Database, terms: string[], limit: number): string[] {
  const matches = new Map<string, number>();

  for (const term of terms) {
    const searchTerm = `%${term}%`;
    const rows = db
      .prepare(
        `
          SELECT path
          FROM files
          WHERE LOWER(path) LIKE LOWER(?)
          ORDER BY path ASC
          LIMIT ?
        `,
      )
      .all(searchTerm, limit) as Array<{ path: string }>;

    for (const row of rows) {
      matches.set(row.path, (matches.get(row.path) ?? 0) + scoreFilePathMatch(row.path, term));
    }
  }

  return Array.from(matches.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([path]) => path);
}

function scoreFilePathMatch(path: string, term: string): number {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(`/${term}.ts`) || lowerPath.endsWith(`/${term}.js`)) {
    return 8;
  }
  if (lowerPath.includes(`/${term}`)) {
    return 5;
  }
  return 3;
}

function buildQuerySections(
  db: Database,
  intent: QueryIntent,
  coreNodes: NodeInfo[],
  relatedNodes: Map<string, NodeInfo>,
  relatedFiles: Set<string>,
  entryPoints: NodeInfo[],
): QuerySection[] {
  const callerLines = buildCallerLines(db, coreNodes, intent === 'impact' ? 4 : 3);
  const signatureLines = coreNodes
    .filter((node) => node.signature || node.docstring)
    .slice(0, intent === 'implementation' ? 4 : 3)
    .map((node) => {
      const summary = [node.signature, node.docstring]
        .filter(Boolean)
        .map((value) => sanitizeInlineText(value!))
        .join(' | ');
      return `${node.name}: ${summary}`;
    });
  const relatedNodeLines = Array.from(relatedNodes.values())
    .filter((node) => !coreNodes.some((coreNode) => coreNode.id === node.id) && node.type !== 'module')
    .sort(sortNodesByImportance)
    .slice(0, intent === 'overview' ? 4 : 2)
    .map((node) => formatNodeLocation(node, node.type));
  const fileLines = Array.from(relatedFiles)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, intent === 'implementation' ? 4 : 5);

  const coreNodeLines = coreNodes.map((node) => {
    const signature = node.signature ? ` - ${sanitizeInlineText(node.signature)}` : '';
    return `${formatNodeLocation(node, node.type)}${signature}`;
  });

  switch (intent) {
    case 'entrypoints':
      return [
        {
          title: 'ENTRY POINTS',
          lines: entryPoints.map((node) => formatNodeLocation(node, `${node.outDegree} outgoing imports`)),
        },
        { title: 'CORE NODES', lines: coreNodeLines },
        { title: 'RELATED FILES', lines: fileLines },
      ];
    case 'impact':
      return [
        { title: 'CORE NODES', lines: coreNodeLines },
        { title: 'CALLERS', lines: callerLines },
        { title: 'RELATED FILES', lines: fileLines },
      ];
    case 'implementation':
      return [
        { title: 'CORE NODES', lines: coreNodeLines },
        { title: 'SIGNATURES', lines: signatureLines },
        { title: 'CALLERS', lines: callerLines },
        { title: 'RELATED FILES', lines: fileLines },
      ];
    case 'overview':
    default:
      return [
        {
          title: 'ENTRY POINTS',
          lines: entryPoints.map((node) => formatNodeLocation(node, `${node.outDegree} outgoing imports`)),
        },
        { title: 'CORE NODES', lines: coreNodeLines },
        { title: 'RELATED NODES', lines: relatedNodeLines },
        { title: 'RELATED FILES', lines: fileLines },
      ];
  }
}

function buildCallerLines(db: Database, coreNodes: NodeInfo[], perNodeLimit: number): string[] {
  const lines: string[] = [];
  for (const node of coreNodes) {
    const callers = getCallers(db, node.id, perNodeLimit);
    const callerText =
      callers.length > 0 ? callers.map((caller) => formatNodeLocation(caller)).join(', ') : 'no indexed callers';
    lines.push(`${node.name}: ${callerText}`);
  }
  return lines;
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'what',
  'where',
  'which',
  'when',
  'how',
  'does',
  'about',
  'have',
  'has',
  'use',
  'using',
  'used',
  'there',
  'their',
  'then',
  'than',
  'into',
  'over',
  'under',
  'your',
  'repo',
  'code',
  'file',
  'files',
]);

const IMPORTANT_SHORT_TERMS = new Set(['api', 'mcp', 'cli', 'sql', 'db', 'ui', 'ux']);

const TERM_EXPANSIONS: Record<string, string[]> = {
  auth: ['authentication', 'authorize', 'jwt', 'session', 'middleware'],
  authentication: ['auth', 'authorize', 'jwt', 'session'],
  query: ['search', 'lookup', 'retrieve', 'graph'],
  search: ['query', 'lookup', 'find'],
  index: ['indexing', 'graph', 'parse', 'scan'],
  graph: ['query', 'node', 'edge', 'subgraph'],
  watch: ['watcher', 'chokidar', 'reindex', 'sync'],
  mcp: ['server', 'stdio', 'tool', 'tools'],
  cli: ['command', 'commander', 'argv', 'program'],
  daemon: ['watch', 'watcher', 'background', 'sync'],
  parse: ['parser', 'ast', 'tree'],
  parser: ['parse', 'ast', 'tree'],
  impact: ['dependents', 'risk', 'callers', 'references'],
};

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
