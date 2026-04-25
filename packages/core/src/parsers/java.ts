import type { ParseResult, Parser } from '../types.js';
import {
  emptyParseResult,
  getLanguageParser,
  safeText,
  buildNode,
  buildEdge,
} from './base.js';

export const JavaParser: Parser = {
  language: 'java',
  extensions: ['.java'],

  async parse(filePath: string, content: string): Promise<ParseResult> {
    let parser;
    try {
      parser = await getLanguageParser('tree-sitter-java');
    } catch {
      return {
        nodes: [],
        edges: [],
        errors: [{ file: filePath, line: null, message: 'Failed to load Java parser' }],
      };
    }

    const result = emptyParseResult();
    let tree;

    try {
      tree = parser.parse(content);
    } catch (e: any) {
      result.errors.push({ file: filePath, line: null, message: e.message });
      return result;
    }

    const rootNode = tree.rootNode;
    const calls: Array<{ fromName: string; toName: string; line: number }> = [];

    const walk = (node: any, currentContextName: string) => {
      // Methods
      if (node.type === 'method_declaration' || node.type === 'constructor_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = safeText(nameNode);
          result.nodes.push(
            buildNode(filePath, {
              type: 'function',
              name,
              language: 'java',
              lineStart: node.startPosition.row + 1,
              lineEnd: node.endPosition.row + 1,
              signature: safeText(node.childForFieldName('parameters')),
            })
          );
          currentContextName = name;
        }
      }

      // Classes / Interfaces / Enums
      if (
        node.type === 'class_declaration' ||
        node.type === 'interface_declaration' ||
        node.type === 'enum_declaration'
      ) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = safeText(nameNode);
          let nodeType: 'class' | 'interface' = 'class';
          if (node.type === 'interface_declaration') nodeType = 'interface';

          result.nodes.push(
            buildNode(filePath, {
              type: nodeType,
              name,
              language: 'java',
              lineStart: node.startPosition.row + 1,
              lineEnd: node.endPosition.row + 1,
            })
          );
          currentContextName = name;
        }
      }

      // Calls
      if (node.type === 'method_invocation') {
        const nameNode = node.childForFieldName('name');
        if (nameNode && currentContextName) {
           const calledName = safeText(nameNode);
           if (calledName) {
             calls.push({
               fromName: currentContextName,
               toName: calledName,
               line: node.startPosition.row + 1,
             });
           }
        }
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        walk(node.namedChild(i), currentContextName);
      }
    };

    walk(rootNode, '');

    result.nodes.push(
      buildNode(filePath, {
        type: 'module',
        name: filePath.split('/').pop() || filePath,
        language: 'java',
      })
    );

    for (const call of calls) {
      result.edges.push(
        buildEdge(
           `${filePath}::function::${call.fromName}`, // Approximation
           `${filePath}::function::${call.toName}`,   // Approximation
          'calls',
          filePath
        )
      );
    }

    return result;
  },
};
