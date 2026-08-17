import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { CodeEdge, CodeGraph, CodeNode } from "./model.js";

export interface HydraDbConfig {
  url: string;
  token: string;
  namespace: string;
  graphId: string;
  cellId: string;
}

export interface GraphSymbol {
  qualifiedName: string;
  name: string;
  kind: string;
  file: string;
  line: number;
  httpMethod?: string;
  routePath?: string;
  handlerQualifiedName?: string;
}

const RELATIONSHIP_KINDS = ["CALLS", "CALLS_API", "IMPORTS", "CONTAINS"] as const;
const CALL_RELATIONSHIP_KINDS = ["CALLS", "CALLS_API"] as const;

interface HydraValue { type: string; value?: unknown }
interface HydraResponse {
  query_id: string;
  columns: string[];
  rows: HydraValue[][];
  next_cursor: number | null;
  bookmark: string | null;
}

export class HydraDbClient {
  constructor(private readonly config: HydraDbConfig) {}

  async query(query: string, parameters: Record<string, unknown> = {}): Promise<HydraResponse> {
    const response = await fetch(`${this.config.url}/v1/graphs/${encodeURIComponent(this.config.graphId)}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "X-Graph-Namespace": this.config.namespace,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cell_id: this.config.cellId, query, parameters }),
    });
    if (!response.ok) throw new Error(`HydraDB query failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<HydraResponse>;
  }

  async ingest(graph: CodeGraph, batchSize = 200): Promise<void> {
    for (const batch of batches(graph.nodes, batchSize)) await this.ingestNodes(batch);
    for (const kind of RELATIONSHIP_KINDS) {
      for (const batch of batches(graph.edges.filter((edge) => edge.kind === kind), batchSize)) {
        await this.ingestEdges(kind, batch);
      }
    }
  }

  async replaceCodeGraph(graph: CodeGraph, batchSize = 200): Promise<void> {
    for (const kind of RELATIONSHIP_KINDS) {
      await this.query(`MATCH ()-[r:${kind}]->() DELETE r`);
    }
    await this.query("MATCH (n:CodeNode) DELETE n");
    await this.ingest(graph, batchSize);
  }

  async findCallers(symbol: string): Promise<Record<string, unknown>[]> {
    const results = await Promise.all(CALL_RELATIONSHIP_KINDS.map(async (kind) => {
      const response = await this.query(
        `MATCH (caller:CodeNode)-[relation:${kind}]->(target:CodeNode {qualified_name: $symbol}) RETURN caller.qualified_name AS caller, caller.file AS file, caller.start_line AS line, caller.kind AS kind, caller.http_method AS http_method, caller.route_path AS route_path, relation.evidence AS evidence`,
        { symbol },
      );
      return rowsToObjects(response).map((row) => callRow(row, "caller", kind));
    }));
    return results.flat();
  }

  async impactOfChange(symbol: string, maxDepth = 10): Promise<Record<string, unknown>[]> {
    const visited = new Set([symbol]);
    const affected: Record<string, unknown>[] = [];
    let frontier = [symbol];

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const caller of await this.findCallers(current)) {
          const qualifiedName = caller.caller;
          if (typeof qualifiedName !== "string" || visited.has(qualifiedName)) continue;
          visited.add(qualifiedName);
          next.push(qualifiedName);
          affected.push({
            symbol: qualifiedName,
            file: caller.file,
            line: caller.line,
            kind: caller.kind,
            ...(caller.httpMethod ? { httpMethod: caller.httpMethod } : {}),
            ...(caller.routePath ? { routePath: caller.routePath } : {}),
            relationship: caller.relationship,
            evidence: caller.evidence,
            depth,
          });
        }
      }
      frontier = next;
    }

    return affected;
  }

  async findCallees(symbol: string): Promise<Record<string, unknown>[]> {
    const results = await Promise.all(CALL_RELATIONSHIP_KINDS.map(async (kind) => {
      const response = await this.query(
        `MATCH (source:CodeNode {qualified_name: $symbol})-[relation:${kind}]->(callee:CodeNode) RETURN callee.qualified_name AS callee, callee.file AS file, callee.start_line AS line, callee.kind AS kind, callee.http_method AS http_method, callee.route_path AS route_path, relation.evidence AS evidence`,
        { symbol },
      );
      return rowsToObjects(response).map((row) => callRow(row, "callee", kind));
    }));
    return results.flat();
  }

  async contextFor(symbol: string): Promise<{ callers: Record<string, unknown>[]; callees: Record<string, unknown>[] }> {
    const [callers, callees] = await Promise.all([this.findCallers(symbol), this.findCallees(symbol)]);
    return { callers, callees };
  }

  async listSymbols(): Promise<GraphSymbol[]> {
    const response = await this.query(
      "MATCH (n:CodeNode) RETURN n.qualified_name AS qualified_name, n.name AS name, n.kind AS kind, n.file AS file, n.start_line AS line, n.http_method AS http_method, n.route_path AS route_path, n.handler_qualified_name AS handler_qualified_name",
    );
    return rowsToObjects(response).flatMap((row) => {
      if (
        typeof row.qualified_name !== "string" ||
        typeof row.name !== "string" ||
        typeof row.kind !== "string" ||
        typeof row.file !== "string" ||
        typeof row.line !== "number"
      ) return [];
      return [{
        qualifiedName: row.qualified_name,
        name: row.name,
        kind: row.kind,
        file: row.file,
        line: row.line,
        httpMethod: typeof row.http_method === "string" && row.http_method ? row.http_method : undefined,
        routePath: typeof row.route_path === "string" && row.route_path ? row.route_path : undefined,
        handlerQualifiedName: typeof row.handler_qualified_name === "string" && row.handler_qualified_name ? row.handler_qualified_name : undefined,
      }];
    });
  }

  private ingestNodes(nodes: CodeNode[]): Promise<HydraResponse> {
    return this.query(
      "UNWIND $rows AS row MERGE (n {id: row.id}) SET n:CodeNode, n.kind = row.kind, n.name = row.name, n.qualified_name = row.qualified_name, n.file = row.file, n.start_line = row.start_line, n.end_line = row.end_line, n.http_method = row.http_method, n.route_path = row.route_path, n.handler_qualified_name = row.handler_qualified_name",
      { rows: nodes.map((node) => ({ id: node.id, kind: node.kind, name: node.name, qualified_name: node.qualifiedName, file: node.file, start_line: node.startLine, end_line: node.endLine, http_method: node.httpMethod ?? "", route_path: node.routePath ?? "", handler_qualified_name: node.handlerQualifiedName ?? "" })) },
    );
  }

  private ingestEdges(kind: CodeEdge["kind"], edges: CodeEdge[]): Promise<HydraResponse> {
    return this.query(
      `UNWIND $rows AS row MATCH (s:CodeNode {id: row.source}), (d:CodeNode {id: row.target}) MERGE (s)-[r:${kind} {id: row.id}]->(d) SET r.evidence = row.evidence`,
      { rows: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, evidence: edge.evidence })) },
    );
  }
}

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function rowsToObjects(response: HydraResponse): Record<string, unknown>[] {
  return response.rows.map((row) => Object.fromEntries(response.columns.map((column, index) => [column, row[index]?.value ?? null])));
}

function callRow(row: Record<string, unknown>, direction: "caller" | "callee", relationship: "CALLS" | "CALLS_API"): Record<string, unknown> {
  return {
    [direction]: row[direction],
    file: row.file,
    line: row.line,
    kind: row.kind,
    ...(typeof row.http_method === "string" && row.http_method ? { httpMethod: row.http_method } : {}),
    ...(typeof row.route_path === "string" && row.route_path ? { routePath: row.route_path } : {}),
    evidence: row.evidence,
    relationship,
  };
}

export function configFromEnvironment(): HydraDbConfig {
  const local = readLocalConfig();
  return {
    url: process.env.HYDRADB_URL ?? local.url ?? "http://127.0.0.1:8443",
    token: required("HYDRADB_TOKEN", local.token),
    namespace: process.env.HYDRADB_NAMESPACE ?? local.namespace ?? "default",
    graphId: process.env.HYDRADB_GRAPH_ID ?? "default",
    cellId: process.env.HYDRADB_CELL_ID ?? "cell-0",
  };
}

function readLocalConfig(): Partial<Pick<HydraDbConfig, "url" | "token" | "namespace">> {
  const path = resolve(process.cwd(), ".hydragraph", "config.json");
  if (!existsSync(path)) return {};

  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object") throw new Error(`Invalid HydraGraph config at ${path}`);
  const config = value as Record<string, unknown>;
  return {
    ...(typeof config.url === "string" ? { url: config.url } : {}),
    ...(typeof config.token === "string" ? { token: config.token } : {}),
    ...(typeof config.namespace === "string" ? { namespace: config.namespace } : {}),
  };
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing ${name}; set it in the environment or .hydragraph/config.json`);
  return value;
}
