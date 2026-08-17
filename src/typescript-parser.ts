import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";

import { stableId } from "./ids.js";
import type { CodeNode, ParsedApiCall, ParsedCall, ParsedFile, ParsedImport } from "./model.js";

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
    const apiCalls: ParsedApiCall[] = [];
    const imports: ParsedImport[] = [];
    const routes: CodeNode[] = [];
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
        const callee = node.childForFieldName("function") ?? node.childForFieldName("constructor");
        if (!callee) return;
        const expression = normalizeCallee(callee.text);

        if (node.type === "call_expression") {
          const route = makeRoute(node, expression, moduleName, relativePath, symbols);
          if (route) routes.push(route);
        }

        const caller = nearestFunctionSymbol(ancestors, symbolByFunctionNode);
        if (!caller) return;
        calls.push({
          callerQualifiedName: caller.qualifiedName,
          calleeExpression: expression,
          calleeName: expression.split(".").at(-1) ?? expression,
          line: node.startPosition.row + 1,
        });

        if (node.type === "call_expression" && expression === "fetch") {
          const path = firstStringArgument(node);
          if (path) apiCalls.push({ callerQualifiedName: caller.qualifiedName, path, line: node.startPosition.row + 1 });
        }
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

    return { file, symbols, calls, apiCalls, imports, routes };
  }
}

function makeRoute(
  node: SyntaxNode,
  expression: string,
  moduleName: string,
  relativePath: string,
  symbols: CodeNode[],
): CodeNode | undefined {
  const match = /^(?:app|router)\.(get|post|put|delete|patch)$/.exec(expression);
  if (!match) return undefined;
  const routePath = firstStringArgument(node);
  if (!routePath) return undefined;
  const method = match[1].toUpperCase();
  const argumentsNode = node.childForFieldName("arguments");
  const handlerNode = argumentsNode?.namedChildren[1];
  const handlerQualifiedName = handlerNode?.type === "identifier"
    ? symbols.find((symbol) => symbol.name === handlerNode.text)?.qualifiedName
    : undefined;
  const qualifiedName = `${moduleName}.route.${method}.${routePath}`;
  return {
    id: stableId(`route:${relativePath}:${method}:${routePath}:${node.startPosition.row + 1}`),
    kind: "route",
    name: `${method} ${routePath}`,
    qualifiedName,
    file: relativePath,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    httpMethod: method,
    routePath,
    handlerQualifiedName,
  };
}

function firstStringArgument(node: SyntaxNode): string | undefined {
  const first = node.childForFieldName("arguments")?.namedChildren[0];
  if (!first) return undefined;
  if (first.type === "string") return first.text.replace(/^['"]|['"]$/g, "");
  if (first.type === "template_string" && !first.namedChildren.some((child) => child.type === "template_substitution")) {
    return first.text.replace(/^`|`$/g, "");
  }
  return undefined;
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
