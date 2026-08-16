import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";

import { stableId } from "./ids.js";
import type { CodeNode, ParsedCall, ParsedFile, ParsedImport } from "./model.js";

type SyntaxNode = Parser.SyntaxNode;

const FUNCTION_NODE_TYPES = new Set([
  "function_declaration",
  "method_definition",
  "arrow_function",
  "function_expression",
]);

export class TypeScriptParser {
  parse(source: string, relativePath: string, tsx = false): ParsedFile {
    const parser = new Parser();
    parser.setLanguage(tsx ? TypeScript.tsx : TypeScript.typescript);
    const tree = parser.parse(source);

    const moduleName = pathToModule(relativePath);
    const file: CodeNode = {
      id: stableId(`file:${relativePath}`),
      kind: "file",
      name: relativePath.split("/").at(-1) ?? relativePath,
      qualifiedName: moduleName,
      file: relativePath,
      startLine: 1,
      endLine: tree.rootNode.endPosition.row + 1,
    };
    const symbols: CodeNode[] = [];
    const calls: ParsedCall[] = [];
    const imports: ParsedImport[] = [];
    const symbolByFunctionNode = new Map<number, CodeNode>();
    const classNames = new Map<number, string>();

    visit(tree.rootNode, (node, ancestors) => {
      if (node.type === "class_declaration") {
        const name = node.childForFieldName("name")?.text;
        if (!name) return;
        classNames.set(node.id, name);
        symbols.push(makeSymbol("class", name, qualify(moduleName, ancestors, name, symbolByFunctionNode, classNames), relativePath, node));
        return;
      }

      if (node.type === "function_declaration" || node.type === "method_definition") {
        const name = node.childForFieldName("name")?.text;
        if (!name) return;
        const kind = node.type === "method_definition" ? "method" : "function";
        const symbol = makeSymbol(kind, name, qualify(moduleName, ancestors, name, symbolByFunctionNode, classNames), relativePath, node);
        symbols.push(symbol);
        symbolByFunctionNode.set(node.id, symbol);
        return;
      }

      if (node.type === "variable_declarator") {
        const value = node.childForFieldName("value");
        const name = node.childForFieldName("name")?.text;
        if (!name || !value || (value.type !== "arrow_function" && value.type !== "function_expression")) return;
        const symbol = makeSymbol("function", name, qualify(moduleName, ancestors, name, symbolByFunctionNode, classNames), relativePath, node);
        symbols.push(symbol);
        symbolByFunctionNode.set(value.id, symbol);
      }
    });

    visit(tree.rootNode, (node, ancestors) => {
      if (node.type === "call_expression" || node.type === "new_expression") {
        const caller = nearestFunctionSymbol(ancestors, symbolByFunctionNode);
        const callee = node.childForFieldName("function") ?? node.childForFieldName("constructor");
        if (!caller || !callee) return;
        const expression = normalizeCallee(callee.text);
        calls.push({
          callerQualifiedName: caller.qualifiedName,
          calleeExpression: expression,
          calleeName: expression.split(".").at(-1) ?? expression,
          line: node.startPosition.row + 1,
        });
      }

      if (node.type === "import_statement") {
        const sourceNode = node.childForFieldName("source");
        if (!sourceNode) return;
        const module = sourceNode.text.replace(/^['"]|['"]$/g, "");
        const names = node.namedChildren
          .filter((child) => child.id !== sourceNode.id)
          .flatMap((child) => collectIdentifiers(child));
        imports.push({ module, names: [...new Set(names)], line: node.startPosition.row + 1 });
      }
    });

    return { file, symbols, calls, imports };
  }
}

function makeSymbol(
  kind: CodeNode["kind"],
  name: string,
  qualifiedName: string,
  file: string,
  node: SyntaxNode,
): CodeNode {
  return {
    id: stableId(`symbol:${qualifiedName}`),
    kind,
    name,
    qualifiedName,
    file,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
}

function qualify(
  moduleName: string,
  ancestors: SyntaxNode[],
  name: string,
  functions: Map<number, CodeNode>,
  classes: Map<number, string>,
): string {
  const owners = ancestors.flatMap((ancestor) => {
    const functionSymbol = functions.get(ancestor.id);
    if (functionSymbol) return [functionSymbol.name];
    const className = classes.get(ancestor.id);
    return className ? [className] : [];
  });
  return [moduleName, ...owners, name].join(".");
}

function nearestFunctionSymbol(ancestors: SyntaxNode[], symbols: Map<number, CodeNode>): CodeNode | undefined {
  for (const ancestor of [...ancestors].reverse()) {
    if (FUNCTION_NODE_TYPES.has(ancestor.type) && symbols.has(ancestor.id)) return symbols.get(ancestor.id);
  }
  return undefined;
}

function collectIdentifiers(node: SyntaxNode): string[] {
  if (node.type === "identifier") return [node.text];
  return node.namedChildren.flatMap((child) => collectIdentifiers(child));
}

function normalizeCallee(value: string): string {
  return value.replaceAll("?.", ".").replace(/<[^<>]*>$/g, "");
}

function visit(node: SyntaxNode, callback: (node: SyntaxNode, ancestors: SyntaxNode[]) => void, ancestors: SyntaxNode[] = []): void {
  callback(node, ancestors);
  for (const child of node.namedChildren) visit(child, callback, [...ancestors, node]);
}

export function pathToModule(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/\.(?:ts|tsx)$/, "").replace(/\/index$/, "").replaceAll("/", ".");
}
