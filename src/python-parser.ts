import Parser from "tree-sitter";
import Python from "tree-sitter-python";

import { stableId } from "./ids.js";
import type { CodeNode, ParsedCall, ParsedFile, ParsedImport } from "./model.js";

type SyntaxNode = Parser.SyntaxNode;

export class PythonParser {
  readonly #parser: Parser;

  constructor() {
    this.#parser = new Parser();
    this.#parser.setLanguage(Python as unknown as Parser.Language);
  }

  parse(source: string, relativePath: string): ParsedFile {
    const tree = this.#parser.parse(source);
    if (tree.rootNode.hasError) {
      throw new Error(`Tree-sitter could not parse ${relativePath} without syntax errors`);
    }

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
    const attributeTypes = inferSelfAttributeTypes(tree.rootNode);

    visit(tree.rootNode, (node, ancestors) => {
      if (node.type === "function_definition") {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) return;
        const enclosingClass = nearestNamedAncestor(ancestors, "class_definition");
        const enclosingFunction = nearestNamedAncestor(ancestors, "function_definition");
        const ownerNames = ancestors
          .filter((item) => item.type === "class_definition" || item.type === "function_definition")
          .map((item) => item.childForFieldName("name")?.text)
          .filter((name): name is string => Boolean(name));
        const qualifiedName = [moduleName, ...ownerNames, nameNode.text].join(".");
        symbols.push({
          id: stableId(`symbol:${qualifiedName}`),
          kind: enclosingClass && !enclosingFunction ? "method" : "function",
          name: nameNode.text,
          qualifiedName,
          file: relativePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }

      if (node.type === "class_definition") {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) return;
        const ownerNames = ancestors
          .filter((item) => item.type === "class_definition")
          .map((item) => item.childForFieldName("name")?.text)
          .filter((name): name is string => Boolean(name));
        const qualifiedName = [moduleName, ...ownerNames, nameNode.text].join(".");
        symbols.push({
          id: stableId(`symbol:${qualifiedName}`),
          kind: "class",
          name: nameNode.text,
          qualifiedName,
          file: relativePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }

      if (node.type === "call") {
        const caller = nearestNamedAncestor(ancestors, "function_definition");
        const callee = node.childForFieldName("function");
        if (!caller || !callee) return;
        const callerName = caller.childForFieldName("name")?.text;
        if (!callerName) return;
        const owners = ancestors
          .filter((item) => item.type === "class_definition" || item.type === "function_definition")
          .map((item) => item.childForFieldName("name")?.text)
          .filter((name): name is string => Boolean(name));
        calls.push({
          callerQualifiedName: [moduleName, ...owners].join("."),
          calleeExpression: callee.text,
          calleeName: callee.text.split(".").at(-1) ?? callee.text,
          receiverType: inferReceiverType(callee.text, owners, attributeTypes),
          line: node.startPosition.row + 1,
        });
      }

      if (node.type === "import_statement" || node.type === "import_from_statement") {
        const parsed = parseImport(node);
        if (parsed) imports.push(parsed);
      }
    });

    return { file, symbols, calls, imports };
  }
}

function inferSelfAttributeTypes(root: SyntaxNode): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  visit(root, (node, ancestors) => {
    if (node.type !== "assignment") return;
    const enclosingClass = nearestNamedAncestor(ancestors, "class_definition");
    const enclosingFunction = nearestNamedAncestor(ancestors, "function_definition");
    if (!enclosingClass || enclosingFunction?.childForFieldName("name")?.text !== "__init__") return;
    const left = node.childForFieldName("left")?.text;
    const right = node.childForFieldName("right");
    if (!left?.startsWith("self.") || right?.type !== "call") return;
    const constructor = right.childForFieldName("function")?.text.split(".")[0];
    if (!constructor || !/^[A-Z]/.test(constructor)) return;
    const className = enclosingClass.childForFieldName("name")?.text;
    if (!className) return;
    const attributes = result.get(className) ?? new Map<string, string>();
    attributes.set(left.slice("self.".length), constructor);
    result.set(className, attributes);
  });
  return result;
}

function inferReceiverType(
  expression: string,
  owners: string[],
  attributeTypes: Map<string, Map<string, string>>,
): string | undefined {
  const match = /^self\.([A-Za-z_][A-Za-z0-9_]*)\./.exec(expression);
  const className = owners[0];
  return match && className ? attributeTypes.get(className)?.get(match[1]!) : undefined;
}

function visit(node: SyntaxNode, callback: (node: SyntaxNode, ancestors: SyntaxNode[]) => void, ancestors: SyntaxNode[] = []): void {
  callback(node, ancestors);
  for (const child of node.namedChildren) visit(child, callback, [...ancestors, node]);
}

function nearestNamedAncestor(ancestors: SyntaxNode[], type: string): SyntaxNode | undefined {
  return [...ancestors].reverse().find((node) => node.type === type);
}

function parseImport(node: SyntaxNode): ParsedImport | undefined {
  if (node.type === "import_from_statement") {
    const moduleNode = node.childForFieldName("module_name");
    if (!moduleNode) return undefined;
    const names = node.namedChildren
      .filter((child) => child.id !== moduleNode.id)
      .flatMap((child) => child.type === "dotted_name" || child.type === "identifier" ? [child.text] : [])
      .filter((name) => name !== moduleNode.text);
    return { module: moduleNode.text, names, line: node.startPosition.row + 1 };
  }
  const names = node.namedChildren.map((child) => child.text.split(" as ")[0]!).filter(Boolean);
  return names.length ? { module: names[0]!, names, line: node.startPosition.row + 1 } : undefined;
}

export function pathToModule(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/\.py$/, "").replace(/\/__init__$/, "").replaceAll("/", ".");
}
