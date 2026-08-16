# HydraGraph MCP

HydraGraph turns a TypeScript codebase into an explicit structural graph and serves graph-native code questions to any MCP client. It uses tree-sitter for AST extraction and self-hosted HydraDB for graph storage and OpenCypher traversal.

> Status: early hackathon MVP. TypeScript/TSX is the deliberately narrow first-language scope.

## Why the implementation differs from the hosted Hydra docs

The self-hosted [`hydra-db/hydradb`](https://github.com/hydra-db/hydradb) repository does **not** expose the hosted knowledge SDK methods (`upload.knowledge`, `full_recall`, or `graph_relations_by_source_id`). Its documented public interfaces are Neo4j-compatible Bolt and:

```text
POST /v1/graphs/{graph_id}/query
```

HydraGraph therefore inserts AST-derived vertices and edges with batched, parameterized OpenCypher `UNWIND` queries. `CALLS`, `IMPORTS`, and `CONTAINS` edges are explicit and deterministic; no LLM relationship inference is involved.

## MCP tools

- `find_callers`: direct reverse traversal over `CALLS` edges.
- `impact_of_change`: bounded transitive reverse traversal for a symbol's blast radius.
- `explain_context`: graph-grounded neighboring symbols and source locations that the MCP client's model can explain with citations.

## Quickstart

Requirements: Node.js 20+, npm, Docker Desktop, and PowerShell for the bundled Windows HydraDB startup script.

```powershell
npm install
Copy-Item .env.example .env
npm run hydradb:start
$env:HYDRADB_TOKEN = "local-development-token-32-bytes"
npm run hydradb:smoke
```

The development script binds Bolt, HTTP, and admin ports to `127.0.0.1` only. It must not be used as a public deployment configuration.

Clone the real validation target next to this repository:

```powershell
git clone https://github.com/sayan365/docwise ../target-docwise
npm run index -- ../target-docwise --dry-run
npm run index -- ../target-docwise
npm run hydradb:validate
npm run mcp:smoke
```

The index command replaces HydraGraph's generated `CodeNode` data and its three relationship types. The MVP intentionally stores one repository per configured HydraDB graph.

Build and run the stdio MCP server:

```powershell
npm run build
node dist/src/server.js
```

## Real validation scenario

The target is [`sayan365/docwise`](https://github.com/sayan365/docwise), Sayan's TypeScript/React document-analysis application. HydraGraph extracts 27 source files, 86 nodes, and 155 resolved relationships. It verifies this real call chain from the checked-out source:

```text
ScanView event handlers
  -> scanSample / scanDocumentText / scanDocumentFile
  -> analyzeWithAI
  -> getLanguage
```

That makes the headline question concrete: changing `src.context.DocumentContext.DocumentProvider.analyzeWithAI` affects all three scan entry points and their upstream UI handlers. External and ambiguous calls remain unresolved instead of being guessed; the current dry run reports 449 such calls.

## What HydraDB contributes

Without HydraDB, this project is an AST dump plus in-process maps. HydraDB persists the structural model and answers traversal queries: callers are incoming `CALLS` edges, and impact is a bounded breadth-first traversal over HydraDB results. The database is load-bearing, not an optional storage swap.

## Verification

```powershell
npm run check
npm test
npm run hydradb:smoke
npm run hydradb:validate
npm run mcp:smoke
```

## Attribution

- [HydraDB](https://github.com/hydra-db/hydradb), AGPL-3.0, used as the external graph database.
- [tree-sitter](https://tree-sitter.github.io/tree-sitter/) and `tree-sitter-typescript`, MIT, used for TypeScript/TSX parsing.
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), MIT, used for MCP transport and tool definitions.
- [Docwise](https://github.com/sayan365/docwise), used as the real-world validation target and not redistributed here.

## License

MIT. See [LICENSE](LICENSE). Project requirements and milestone evidence are tracked in [docs/PRD.md](docs/PRD.md).
