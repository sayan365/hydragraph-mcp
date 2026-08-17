export type CodeNodeKind = "file" | "class" | "function" | "method" | "route";

export interface CodeNode {
  id: number;
  kind: CodeNodeKind;
  name: string;
  qualifiedName: string;
  file: string;
  startLine: number;
  endLine: number;
  httpMethod?: string;
  routePath?: string;
  handlerQualifiedName?: string;
}

export type CodeEdgeKind = "CONTAINS" | "CALLS" | "CALLS_API" | "IMPORTS";

export interface CodeEdge {
  id: number;
  kind: CodeEdgeKind;
  source: number;
  target: number;
  evidence: string;
}

export interface ParsedFile {
  file: CodeNode;
  symbols: CodeNode[];
  calls: ParsedCall[];
  apiCalls: ParsedApiCall[];
  imports: ParsedImport[];
  routes: CodeNode[];
}

export interface ParsedApiCall {
  callerQualifiedName: string;
  path: string;
  line: number;
}

export interface ParsedCall {
  callerQualifiedName: string;
  calleeExpression: string;
  calleeName: string;
  receiverType?: string;
  line: number;
}

export interface ParsedImport {
  module: string;
  names: string[];
  line: number;
}

export interface CodeGraph {
  nodes: CodeNode[];
  edges: CodeEdge[];
  unresolvedCalls: ParsedCall[];
  unresolvedApiCalls: ParsedApiCall[];
}
