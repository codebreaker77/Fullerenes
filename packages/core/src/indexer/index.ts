import { readFileSync } from 'node:fs';
import pLimit from 'p-limit';
import { initDatabase, getDbPath, setMeta } from '../db/schema.js';
import { walkProject } from '../utils/walker.js';
import { getParser, initTreeSitter } from '../parsers/index.js';
import { hashContent } from '../parsers/base.js';
import type { IndexOptions, IndexResult, ParseResult } from '../types.js';

type PendingFile = {
  path: string;
  relPath: string;
  language: string;
  hash: string;
  size: number;
};

export async function indexProject(
  rootDir: string,
  options?: IndexOptions,
): Promise<IndexResult> {
  const startTime = Date.now();
  const db = initDatabase(getDbPath(rootDir));

  await initTreeSitter();

  const incremental = options?.incremental ?? false;
  const limit = pLimit(options?.concurrency ?? 4);

  const result: IndexResult = {
    filesIndexed: 0,
    filesSkipped: 0,
    nodesAdded: 0,
    nodesRemoved: 0,
    edgesAdded: 0,
    durationMs: 0,
    errors: [],
  };

  const filesToParse: PendingFile[] = [];
  const seenFiles = new Set<string>();

  for await (const file of walkProject(rootDir)) {
    seenFiles.add(file.relativePath);

    try {
      const content = readFileSync(file.path, 'utf-8');
      const hash = hashContent(content);

      if (incremental) {
        const existing = db.prepare('SELECT hash FROM files WHERE path = ?').get(file.relativePath) as
          | { hash: string }
          | undefined;
        if (existing && existing.hash === hash) {
          result.filesSkipped++;
          continue;
        }
      }

      filesToParse.push({
        path: file.path,
        relPath: file.relativePath,
        language: file.language,
        hash,
        size: file.sizeBytes,
      });
    } catch (error: any) {
      result.errors.push({
        file: file.relativePath,
        line: null,
        message: `Read error: ${error.message}`,
      });
      options?.onError?.(file.relativePath, error);
    }
  }

  const deletedFiles = (db.prepare('SELECT path FROM files').all() as Array<{ path: string }>)
    .map((row) => row.path)
    .filter((path) => !seenFiles.has(path));

  const total = filesToParse.length;
  let current = 0;

  const parseJobs = filesToParse.map((file) =>
    limit(async () => {
      const parser = getParser(file.language as any);
      if (!parser) {
        return null;
      }

      try {
        const content = readFileSync(file.path, 'utf-8');
        const parseResult = await parser.parse(file.relPath, content);
        current += 1;
        options?.onProgress?.(current, total, file.relPath);
        return { file, parseResult };
      } catch (error: any) {
        result.errors.push({
          file: file.relPath,
          line: null,
          message: `Parse error: ${error.message}`,
        });
        options?.onError?.(file.relPath, error);
        return null;
      }
    }),
  );

  const parsedResults = (await Promise.all(parseJobs)).filter(Boolean) as Array<{
    file: PendingFile;
    parseResult: ParseResult;
  }>;

  const getNodeIdsByFile = db.prepare('SELECT id FROM nodes WHERE file_path = ?');
  const deleteNodeEdgesByFile = db.prepare(`
    DELETE FROM edges
    WHERE file_path = ?
      OR from_id IN (SELECT id FROM nodes WHERE file_path = ?)
      OR to_id IN (SELECT id FROM nodes WHERE file_path = ?)
  `);
  const deleteNodesByFile = db.prepare('DELETE FROM nodes WHERE file_path = ?');
  const deleteFileRecord = db.prepare('DELETE FROM files WHERE path = ?');
  const insertNode = db.prepare(`
    INSERT OR REPLACE INTO nodes (id, type, name, file_path, line_start, line_end, signature, docstring, language, hash, metadata)
    VALUES (@id, @type, @name, @file_path, @line_start, @line_end, @signature, @docstring, @language, @hash, @metadata)
  `);
  const insertEdge = db.prepare(`
    INSERT OR REPLACE INTO edges (id, from_id, to_id, type, weight, file_path)
    VALUES (@id, @from_id, @to_id, @type, @weight, @file_path)
  `);
  const updateFile = db.prepare(`
    INSERT OR REPLACE INTO files (path, hash, language, size_bytes, node_count, last_indexed)
    VALUES (@path, @hash, @language, @size_bytes, @node_count, @last_indexed)
  `);

  const transact = db.transaction(() => {
    for (const deletedFile of deletedFiles) {
      const previousNodeIds = new Set(
        (getNodeIdsByFile.all(deletedFile) as Array<{ id: string }>).map((row) => row.id),
      );
      result.nodesRemoved += previousNodeIds.size;
      deleteNodeEdgesByFile.run(deletedFile, deletedFile, deletedFile);
      deleteNodesByFile.run(deletedFile);
      deleteFileRecord.run(deletedFile);
    }

    for (const { file, parseResult } of parsedResults) {
      const previousNodeIds = new Set(
        (getNodeIdsByFile.all(file.relPath) as Array<{ id: string }>).map((row) => row.id),
      );
      const nextNodeIds = new Set(parseResult.nodes.map((node) => node.id));

      result.nodesRemoved += Array.from(previousNodeIds).filter((id) => !nextNodeIds.has(id)).length;
      result.nodesAdded += Array.from(nextNodeIds).filter((id) => !previousNodeIds.has(id)).length;

      deleteNodeEdgesByFile.run(file.relPath, file.relPath, file.relPath);
      deleteNodesByFile.run(file.relPath);

      for (const node of parseResult.nodes) {
        insertNode.run(node);
      }

      const uniqueEdges = Array.from(new Map(parseResult.edges.map((edge) => [edge.id, edge])).values());
      for (const edge of uniqueEdges) {
        insertEdge.run(edge);
      }

      result.edgesAdded += uniqueEdges.length;

      updateFile.run({
        path: file.relPath,
        hash: file.hash,
        language: file.language,
        size_bytes: file.size,
        node_count: parseResult.nodes.length,
        last_indexed: Date.now(),
      });

      result.filesIndexed++;
      result.errors.push(...parseResult.errors);
    }
  });

  transact();

  setMeta(db, 'last_indexed', Date.now().toString());
  setMeta(
    db,
    'stats',
    JSON.stringify({
      filesIndexed: result.filesIndexed,
      filesSkipped: result.filesSkipped,
      nodesAdded: result.nodesAdded,
      nodesRemoved: result.nodesRemoved,
      edgesAdded: result.edgesAdded,
    }),
  );

  result.durationMs = Date.now() - startTime;
  db.close();

  return result;
}
