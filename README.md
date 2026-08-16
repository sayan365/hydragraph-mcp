# HydraGraph MCP

HydraGraph turns a real codebase into an explicit structural graph and serves graph-native code questions to any MCP client. It uses tree-sitter for AST extraction and self-hosted HydraDB for graph storage and OpenCypher traversal.

> Status: early hackathon MVP. Python is the first indexed language; the MCP server itself is TypeScript.

## Why the implementation differs from the hosted Hydra docs

The self-hosted [`hydra-db/hydradb`](https://github.com/hydra-db/hydradb) repository does **not** expose the hosted knowledge SDK methods (`upload.knowledge`, `full_recall`, or `graph_relations_by_source_id`). Its documented public interfaces are Neo4j-compatible Bolt and:

```text
POST /v1/graphs/{graph_id}/query
```

HydraGraph therefore inserts AST-derived vertices and edges with batched, parameterized OpenCypher `UNWIND` queries. `CALLS`, `IMPORTS`, and `CONTAINS` edges are explicit and deterministic; no LLM relation inference is involved.

## Current MCP tools

- `find_callers`: direct reverse traversal over `CALLS` edges.
- `impact_of_change`: transitive reverse traversal for a symbol's blast radius.
- `explain_context`: graph-grounded neighboring symbols and source locations that the MCP client's model can explain with citations.

## Quickstart

Requirements: Node.js 20+, npm, and a running self-hosted HydraDB node.

```bash
npm install
cp .env.example .env
```

Load the environment variables, then inspect a repository without writing to HydraDB:

```bash
npm run index -- ../target-groundline/code --dry-run
```

Index it into HydraDB:

```bash
npm run index -- ../target-groundline/code
```

Build and run the stdio MCP server:

```bash
npm run build
node dist/src/server.js
```

## Target repository

The initial validation target is [SAYOUNCDR/Groundline](https://github.com/SAYOUNCDR/Groundline), a real Python support-triage backend. Its classification, retrieval, evidence grading, reranking, generation, verification, and evaluation pipeline provides meaningful call chains for blast-radius validation.

## What HydraDB contributes

Without HydraDB, this project is an AST dump plus in-process maps. HydraDB makes the structural model persistable and queryable through graph traversal: callers are incoming `CALLS` edges, and impact is a bounded variable-length reverse traversal. That is the product's core behavior, not an optional storage swap.

## Attribution

- [HydraDB](https://github.com/hydra-db/hydradb), AGPL-3.0, used as the external graph database.
- [tree-sitter](https://tree-sitter.github.io/tree-sitter/) and `tree-sitter-python`, MIT, used for syntax parsing.
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), MIT, used for MCP transport and tool definitions.
- [Groundline](https://github.com/SAYOUNCDR/Groundline), used as the initial real-world validation target and not redistributed here.

## License

MIT. See [LICENSE](LICENSE).
