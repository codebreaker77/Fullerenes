import { posix } from 'node:path';
import type { ParseResult, Parser, NodeRecord } from '../types.js';
import {
  emptyParseResult,
  getLanguageParser,
  safeText,
  buildNode,
  buildEdge,
  makeModuleNodeId,
  makeNodeId,
  getModuleNodeName,
} from './base.js';

export const PythonParser: Parser = {
  language: 'python',
  extensions: ['.py'],

  async parse(filePath: string, content: string): Promise<ParseResult> {
    let parser;
    try {
      parser = await getLanguageParser('tree-sitter-python');
    } catch {
      return {
        nodes: [],
        edges: [],
        errors: [{ file: filePath, line: null, message: 'Failed to load Python parser' }],
      };
    }

    const result = emptyParseResult();
    let tree;

    try {
      tree = parser.parse(content);
    } catch (error: any) {
      result.errors.push({ file: filePath, line: null, message: error.message });
      return result;
    }

    const moduleName = getModuleNodeName(filePath);
    const moduleId = makeModuleNodeId(filePath);
    result.nodes.push(
      buildNode(filePath, {
        type: 'module',
        name: moduleName,
        language: 'python',
        lineStart: 1,
        lineEnd: tree.rootNode.endPosition.row + 1,
      }),
    );

    const walk = (node: any, currentContextName: string) => {
      const extracted = extractPythonNode(filePath, node);
      let nextContextName = currentContextName;

      if (extracted) {
        result.nodes.push(extracted);
        result.edges.push(buildEdge(moduleId, extracted.id, 'contains', filePath));
        nextContextName = extracted.name;
      }

      for (const importPath of extractPythonImports(filePath, node)) {
        result.edges.push(buildEdge(moduleId, makeModuleNodeId(importPath), 'imports', filePath));
      }

      if (node.type === 'call') {
        const functionNode = node.childForFieldName('function');
        if (functionNode && nextContextName) {
          let calledName = safeText(functionNode);
          if (functionNode.type === 'attribute') {
            const attributeNode = functionNode.childForFieldName('attribute');
            if (attributeNode) {
              calledName = safeText(attributeNode);
            }
          }

          if (calledName) {
            result.edges.push(
              buildEdge(
                makeNodeId(filePath, 'function', nextContextName),
                makeNodeId(filePath, 'function', calledName),
                'calls',
                filePath,
              ),
            );
          }
        }
      }

      for (let index = 0; index < node.namedChildCount; index++) {
        walk(node.namedChild(index), nextContextName);
      }
    };

    walk(tree.rootNode, '');
    result.edges = dedupeEdges(result.edges);

    return result;
  },
};

function extractPythonNode(filePath: string, node: any): NodeRecord | null {
  if (node.type === 'function_definition') {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return null;
    }

    return buildNode(filePath, {
      type: 'function',
      name: safeText(nameNode),
      language: 'python',
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1,
      signature: buildPythonSignature(node),
      docstring: extractPythonDocstring(node),
    });
  }

  if (node.type === 'class_definition') {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return null;
    }

    return buildNode(filePath, {
      type: 'class',
      name: safeText(nameNode),
      language: 'python',
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1,
      docstring: extractPythonDocstring(node),
      metadata: {
        bases: extractBases(node),
      },
    });
  }

  return null;
}

function buildPythonSignature(node: any): string | null {
  const parameters = safeText(node.childForFieldName('parameters'));
  const returnType = safeText(node.childForFieldName('return_type'));
  if (!parameters && !returnType) {
    return null;
  }

  return `${parameters}${returnType ? ` -> ${returnType}` : ''}`;
}

function extractPythonDocstring(node: any): string | null {
  const bodyNode = node.childForFieldName('body');
  const firstStatement = bodyNode?.namedChild(0);
  if (!firstStatement || firstStatement.type !== 'expression_statement') {
    return null;
  }

  const stringNode = firstStatement.namedChild(0);
  const text = safeText(stringNode);
  if (!text.startsWith('"') && !text.startsWith("'")) {
    return null;
  }

  return text;
}

function extractBases(node: any): string[] {
  const superclasses = node.childForFieldName('superclasses');
  if (!superclasses) {
    return [];
  }

  const bases: string[] = [];
  for (let index = 0; index < superclasses.namedChildCount; index++) {
    const child = superclasses.namedChild(index);
    const text = safeText(child);
    if (text) {
      bases.push(text);
    }
  }

  return bases;
}

function extractPythonImports(filePath: string, node: any): string[] {
  if (node.type === 'import_statement') {
    const text = safeText(node).replace(/^import\s+/, '');
    return text
      .split(',')
      .map((entry) => entry.trim().split(/\s+as\s+/)[0]?.trim())
      .filter((entry): entry is string => Boolean(entry))
      .map((entry) => moduleNameToPath(entry));
  }

  if (node.type !== 'import_from_statement') {
    return [];
  }

  const text = safeText(node);
  const match = /^from\s+([.\w]+)\s+import\s+(.+)$/.exec(text);
  if (!match) {
    return [];
  }

  const rawSource = match[1] ?? '';
  const rawImports = match[2] ?? '';
  const leadingDots = rawSource.match(/^\.+/)?.[0].length ?? 0;
  const source = rawSource.slice(leadingDots);
  const names = rawImports
    .split(',')
    .map((entry) => entry.trim().split(/\s+as\s+/)[0]?.trim())
    .filter((entry): entry is string => Boolean(entry));

  if (leadingDots === 0) {
    return [moduleNameToPath(source)];
  }

  const currentDir = posix.dirname(filePath);
  const baseDir = climbUp(currentDir, Math.max(leadingDots - 1, 0));
  if (source) {
    return [moduleNameToRelativePath(baseDir, source)];
  }

  return names.map((name) => moduleNameToRelativePath(baseDir, name));
}

function moduleNameToPath(moduleName: string): string {
  return `${moduleName.replace(/\./g, '/')}.py`;
}

function moduleNameToRelativePath(baseDir: string, moduleName: string): string {
  return posix.normalize(posix.join(baseDir, moduleName.replace(/\./g, '/'))) + '.py';
}

function climbUp(directory: string, count: number): string {
  let current = directory;
  for (let index = 0; index < count; index++) {
    current = posix.dirname(current);
  }
  return current;
}

function dedupeEdges<T extends { id: string }>(edges: T[]): T[] {
  return Array.from(new Map(edges.map((edge) => [edge.id, edge])).values());
}
