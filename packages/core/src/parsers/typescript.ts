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

const TS_MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

export const TypeScriptParser: Parser = {
  language: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx'],

  async parse(filePath: string, content: string): Promise<ParseResult> {
    const isTSX = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
    const wasmName = isTSX ? 'tree-sitter-tsx' : 'tree-sitter-typescript';

    let parser;
    try {
      parser = await getLanguageParser(wasmName);
    } catch {
      return {
        nodes: [],
        edges: [],
        errors: [{ file: filePath, line: null, message: 'Failed to load TS parser' }],
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
    const moduleNode = buildNode(filePath, {
      type: 'module',
      name: moduleName,
      language: 'typescript',
      lineStart: 1,
      lineEnd: tree.rootNode.endPosition.row + 1,
    });
    result.nodes.push(moduleNode);

    const walk = (node: any, currentContextName: string) => {
      const extracted = extractTypeScriptNode(filePath, node);
      let nextContextName = currentContextName;

      if (extracted) {
        result.nodes.push(extracted);
        result.edges.push(buildEdge(moduleId, extracted.id, 'contains', filePath));
        nextContextName = extracted.name;
      }

      const importEdge = extractImportEdge(filePath, moduleId, node);
      if (importEdge) {
        result.edges.push(importEdge);
      }

      const requireEdge = extractRequireEdge(filePath, moduleId, node);
      if (requireEdge) {
        result.edges.push(requireEdge);
      }

      if (node.type === 'call_expression') {
        const functionNode = node.childForFieldName('function');
        if (functionNode && nextContextName) {
          let calledName = safeText(functionNode);
          if (functionNode.type === 'member_expression') {
            const propertyNode = functionNode.childForFieldName('property');
            if (propertyNode) {
              calledName = safeText(propertyNode);
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

function extractTypeScriptNode(filePath: string, node: any): NodeRecord | null {
  if (
    node.type === 'function_declaration' ||
    node.type === 'method_definition' ||
    node.type === 'function_signature'
  ) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return null;
    }

    return buildNode(filePath, {
      type: 'function',
      name: safeText(nameNode),
      language: 'typescript',
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1,
      signature: buildFunctionSignature(node),
      docstring: extractLeadingComment(node),
    });
  }

  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    const declarator = findArrowFunctionDeclarator(node);
    if (!declarator) {
      return null;
    }

    const nameNode = declarator.childForFieldName('name');
    const valueNode = declarator.childForFieldName('value');
    if (!nameNode || !valueNode) {
      return null;
    }

    return buildNode(filePath, {
      type: 'function',
      name: safeText(nameNode),
      language: 'typescript',
      lineStart: valueNode.startPosition.row + 1,
      lineEnd: valueNode.endPosition.row + 1,
      signature: safeText(valueNode.childForFieldName('parameters')),
      docstring: extractLeadingComment(node),
    });
  }

  if (node.type === 'class_declaration') {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return null;
    }

    return buildNode(filePath, {
      type: 'class',
      name: safeText(nameNode),
      language: 'typescript',
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1,
      docstring: extractLeadingComment(node),
    });
  }

  if (node.type === 'interface_declaration' || node.type === 'type_alias_declaration') {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return null;
    }

    return buildNode(filePath, {
      type: node.type === 'interface_declaration' ? 'interface' : 'type',
      name: safeText(nameNode),
      language: 'typescript',
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1,
      docstring: extractLeadingComment(node),
    });
  }

  return null;
}

function extractImportEdge(filePath: string, moduleId: string, node: any) {
  if (node.type !== 'import_statement') {
    return null;
  }

  const sourceNode = node.childForFieldName('source');
  const specifier = stripQuotes(safeText(sourceNode));
  const importedPath = resolveTypeScriptImport(filePath, specifier);
  if (!importedPath) {
    return null;
  }

  return buildEdge(moduleId, makeModuleNodeId(importedPath), 'imports', filePath);
}

function extractRequireEdge(filePath: string, moduleId: string, node: any) {
  if (node.type !== 'call_expression') {
    return null;
  }

  const functionNode = node.childForFieldName('function');
  if (!functionNode || safeText(functionNode) !== 'require') {
    return null;
  }

  const argumentsNode = node.childForFieldName('arguments');
  const argumentNode = argumentsNode?.namedChild(0);
  const specifier = stripQuotes(safeText(argumentNode));
  const importedPath = resolveTypeScriptImport(filePath, specifier);
  if (!importedPath) {
    return null;
  }

  return buildEdge(moduleId, makeModuleNodeId(importedPath), 'imports', filePath);
}

function resolveTypeScriptImport(filePath: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const fromDir = posix.dirname(filePath);
  const normalizedBase = posix.normalize(posix.join(fromDir, specifier));
  const hasKnownExtension = TS_MODULE_EXTENSIONS.some((extension) => normalizedBase.endsWith(extension));

  if (hasKnownExtension) {
    return normalizedBase;
  }

  return `${normalizedBase}.ts`;
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

function buildFunctionSignature(node: any): string | null {
  const parameters = safeText(node.childForFieldName('parameters'));
  const returnType = safeText(node.childForFieldName('return_type'));
  if (!parameters && !returnType) {
    return null;
  }

  return `${parameters}${returnType ? ` => ${returnType}` : ''}`;
}

function findArrowFunctionDeclarator(node: any): any | null {
  for (let index = 0; index < node.namedChildCount; index++) {
    const child = node.namedChild(index);
    if (child?.type !== 'variable_declarator') {
      continue;
    }

    const valueNode = child.childForFieldName('value');
    if (valueNode?.type === 'arrow_function') {
      return child;
    }
  }

  return null;
}

function extractLeadingComment(node: any): string | null {
  const previousSibling = node.previousNamedSibling ?? node.previousSibling;
  const text = safeText(previousSibling);
  if (!text || (!text.startsWith('/**') && !text.startsWith('//'))) {
    return null;
  }

  return text;
}

function dedupeEdges<T extends { id: string }>(edges: T[]): T[] {
  return Array.from(new Map(edges.map((edge) => [edge.id, edge])).values());
}
