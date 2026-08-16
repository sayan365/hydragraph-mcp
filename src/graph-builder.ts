import type { CodeEdge, CodeGraph, CodeNode, ParsedFile } from "./model.js";
import { stableId } from "./ids.js";

export function buildGraph(files: ParsedFile[]): CodeGraph {
  const nodes = files.flatMap((file) => [file.file, ...file.symbols]);
  const byQualifiedName = new Map(nodes.map((node) => [node.qualifiedName, node]));
  const bySimpleName = groupBy(nodes, (node) => node.name);
  const moduleFiles = new Map(files.map((file) => [withoutSourceExtension(file.file.file), file.file]));
  const edges: CodeEdge[] = [];
  const unresolvedCalls = [];

  for (const parsed of files) {
    for (const symbol of parsed.symbols) {
      edges.push(edge("CONTAINS", parsed.file, symbol, `${symbol.file}:${symbol.startLine}`));
    }
    for (const item of parsed.imports) {
      const target = resolveModule(item.module, parsed.file.file, moduleFiles);
      if (target) edges.push(edge("IMPORTS", parsed.file, target, `${parsed.file.file}:${item.line}`));
    }
    for (const call of parsed.calls) {
      const caller = byQualifiedName.get(call.callerQualifiedName);
      const candidates = bySimpleName.get(call.calleeName) ?? [];
      const callee = chooseCallee(call.calleeExpression, call.receiverType, caller, candidates);
      if (caller && callee) {
        edges.push(edge("CALLS", caller, callee, `${caller.file}:${call.line} ${call.calleeExpression}`));
      } else {
        unresolvedCalls.push(call);
      }
    }
  }

  return { nodes, edges: deduplicateEdges(edges), unresolvedCalls };
}

function chooseCallee(expression: string, receiverType: string | undefined, caller: CodeNode | undefined, candidates: CodeNode[]): CodeNode | undefined {
  if (!caller) return undefined;
  if (expression.includes(".")) {
    if (receiverType) {
      const typed = candidates.filter((candidate) => candidate.qualifiedName.includes(`.${receiverType}.`));
      if (typed.length === 1) return typed[0];
    }
    if (expression === `self.${candidates[0]?.name}`) {
      const callerClass = caller.qualifiedName.split(".").slice(0, -1).join(".");
      return candidates.find((candidate) => candidate.qualifiedName.startsWith(`${callerClass}.`));
    }
    const explicitReceiver = expression.split(".").at(-2);
    if (explicitReceiver && /^[A-Z]/.test(explicitReceiver)) {
      const explicit = candidates.filter((candidate) => candidate.qualifiedName.includes(`.${explicitReceiver}.`));
      if (explicit.length === 1) return explicit[0];
    }
    return undefined;
  }
  if (candidates.length === 1) return candidates[0];
  const sameFile = candidates.filter((candidate) => candidate.file === caller.file);
  if (sameFile.length === 1) return sameFile[0];
  return undefined;
}

function resolveModule(moduleName: string, importerFile: string, modules: Map<string, CodeNode>): CodeNode | undefined {
  if (!moduleName.startsWith(".")) return undefined;
  const importerParts = importerFile.split("/").slice(0, -1);
  const targetParts = [...importerParts, ...moduleName.split("/")];
  const normalized: string[] = [];
  for (const part of targetParts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  const target = withoutSourceExtension(normalized.join("/"));
  return modules.get(target) ?? modules.get(`${target}/index`);
}

function withoutSourceExtension(file: string): string {
  return file.replace(/\.(?:js|jsx|ts|tsx)$/, "");
}

function edge(kind: CodeEdge["kind"], source: CodeNode, target: CodeNode, evidence: string): CodeEdge {
  return {
    id: stableId(`edge:${kind}:${source.id}:${target.id}`),
    kind,
    source: source.id,
    target: target.id,
    evidence,
  };
}

function deduplicateEdges(edges: CodeEdge[]): CodeEdge[] {
  return [...new Map(edges.map((item) => [item.id, item])).values()];
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const item of items) result.set(key(item), [...(result.get(key(item)) ?? []), item]);
  return result;
}
