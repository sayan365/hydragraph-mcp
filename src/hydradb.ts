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
}

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
    for (const kind of ["CONTAINS", "IMPORTS", "CALLS"] as const) {
      for (const batch of batches(graph.edges.filter((edge) => edge.kind === kind), batchSize)) {
        await this.ingestEdges(kind, batch);
      }
    }
  }

  async replaceCodeGraph(graph: CodeGraph, batchSize = 200): Promise<void> {
    for (const kind of ["CALLS", "IMPORTS", "CONTAINS"] as const) {
      await this.query(`MATCH ()-[r:${kind}]->() DELETE r`);
    }
    await this.query("MATCH (n:CodeNode) DELETE n");
    await this.ingest(graph, batchSize);
  }

  async findCallers(symbol: string): Promise<Record<string, unknown>[]> {
    const response = await this.query(
      "MATCH (caller:CodeNode)-[relation:CALLS]->(target:CodeNode {qualified_name: $symbol}) RETURN caller.qualified_name AS caller, caller.file AS file, caller.start_line AS line, relation.evidence AS evidence",
      { symbol },
    );
    return rowsToObjects(response);
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
          affected.push({ symbol: qualifiedName, file: caller.file, line: caller.line, evidence: caller.evidence, depth });
        }
      }
      frontier = next;
    }

    return affected;
  }

  async findCallees(symbol: string): Promise<Record<string, unknown>[]> {
    const response = await this.query(
      "MATCH (source:CodeNode {qualified_name: $symbol})-[relation:CALLS]->(callee:CodeNode) RETURN callee.qualified_name AS callee, callee.file AS file, callee.start_line AS line, relation.evidence AS evidence",
      { symbol },
    );
    return rowsToObjects(response);
  }

  async contextFor(symbol: string): Promise<{ callers: Record<string, unknown>[]; callees: Record<string, unknown>[] }> {
    const [callers, callees] = await Promise.all([this.findCallers(symbol), this.findCallees(symbol)]);
    return { callers, callees };
  }

  async listSymbols(): Promise<GraphSymbol[]> {
    const response = await this.query(
      "MATCH (n:CodeNode) RETURN n.qualified_name AS qualified_name, n.name AS name, n.kind AS kind, n.file AS file, n.start_line AS line",
    );
    return rowsToObjects(response).flatMap((row) => {
      if (
        typeof row.qualified_name !== "string" ||
        typeof row.name !== "string" ||
        typeof row.kind !== "string" ||
        typeof row.file !== "string" ||
        typeof row.line !== "number"
      ) return [];
      return [{ qualifiedName: row.qualified_name, name: row.name, kind: row.kind, file: row.file, line: row.line }];
    });
  }

  private ingestNodes(nodes: CodeNode[]): Promise<HydraResponse> {
    return this.query(
      "UNWIND $rows AS row MERGE (n {id: row.id}) SET n:CodeNode, n.kind = row.kind, n.name = row.name, n.qualified_name = row.qualified_name, n.file = row.file, n.start_line = row.start_line, n.end_line = row.end_line",
      { rows: nodes.map((node) => ({ id: node.id, kind: node.kind, name: node.name, qualified_name: node.qualifiedName, file: node.file, start_line: node.startLine, end_line: node.endLine })) },
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

export function configFromEnvironment(): HydraDbConfig {
  return {
    url: process.env.HYDRADB_URL ?? "http://127.0.0.1:8443",
    token: required("HYDRADB_TOKEN"),
    namespace: process.env.HYDRADB_NAMESPACE ?? "default",
    graphId: process.env.HYDRADB_GRAPH_ID ?? "default",
    cellId: process.env.HYDRADB_CELL_ID ?? "cell-0",
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
