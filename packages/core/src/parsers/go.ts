import type { ParseResult, Parser } from '../types.js';
import {
  emptyParseResult,
  getLanguageParser,
  safeText,
  buildNode,
  buildEdge,
} from './base.js';

export const GoParser: Parser = {
  language: 'go',
  extensions: ['.go'],

  async parse(filePath: string, content: string): Promise<ParseResult> {
    let parser;
    try {
      parser = await getLanguageParser('tree-sitter-go');
    } catch {
      return {
        nodes: [],
        edges: [],
        errors: [{ file: filePath, line: null, message: 'Failed to load Go parser' }],
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
      // Functions / Methods
      if (node.type === 'function_declaration' || node.type === 'method_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = safeText(nameNode);
          result.nodes.push(
            buildNode(filePath, {
              type: 'function',
              name,
              language: 'go',
              lineStart: node.startPosition.row + 1,
              lineEnd: node.endPosition.row + 1,
              signature: safeText(node.childForFieldName('parameters')),
            })
          );
          currentContextName = name;
        }
      }

      // Types (Struct/Interface)
      if (node.type === 'type_spec') {
        const nameNode = node.childForFieldName('name');
        const typeNode = node.childForFieldName('type');
        if (nameNode && typeNode) {
            const name = safeText(nameNode);
            const typeStr = safeText(typeNode);
             let nodeType: 'class' | 'interface' | 'type' = 'type';
             if(typeStr.startsWith('struct')) nodeType = 'class'; // Map struct to class
             else if(typeStr.startsWith('interface')) nodeType = 'interface';

            result.nodes.push(
                buildNode(filePath, {
                type: nodeType,
                name,
                language: 'go',
                lineStart: node.startPosition.row + 1,
                lineEnd: node.endPosition.row + 1,
                })
            );
            currentContextName = name;
        }
      }

      // Calls
      if (node.type === 'call_expression') {
        const functionNode = node.childForFieldName('function');
        if (functionNode && currentContextName) {
           let calledName = safeText(functionNode);
           if(functionNode.type === 'selector_expression') {
               const fieldNode = functionNode.childForFieldName('field');
               if(fieldNode) calledName = safeText(fieldNode);
           }
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
        language: 'go',
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
