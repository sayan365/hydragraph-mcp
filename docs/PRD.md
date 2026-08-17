# HydraGraph MCP — Product Requirements and Progress

Last updated: August 17, 2026

## Product

HydraGraph is a code-graph MCP server backed by self-hosted HydraDB. It answers structural questions such as “who calls this?” and “what is the blast radius of changing this symbol?” from deterministic AST relationships instead of embedding similarity.

The hackathon scope is intentionally narrow: TypeScript/TSX, one real target repository (`sayan365/docwise`), three MCP tools, and no dashboard.

## Confirmed architecture

Inspection of the real `hydra-db/hydradb` README and source confirmed that self-hosted OSS exposes Neo4j-compatible Bolt and an OpenCypher HTTP API:

```text
POST /v1/graphs/{graph_id}/query
GET  /readyz
```

It does not expose the hosted knowledge/recall SDK. HydraGraph writes explicit `CodeNode` vertices and `CALLS`, `CALLS_API`, `IMPORTS`, and `CONTAINS` relationships with parameterized `UNWIND` queries. Impact analysis uses a bounded client-side breadth-first traversal because the current OSS query engine rejects the needed incoming variable-length pattern.

## Target and demo truth

The sole validation target is [sayan365/docwise](https://github.com/sayan365/docwise), a real TypeScript/React document-analysis application owned by the project author. Groundline and OpenDesk were briefly inspected by mistake and are not targets; all claims and validation tied to them have been removed.

The headline change target is:

```text
src.context.DocumentContext.DocumentProvider.analyzeWithAI
```

From the actual Docwise source, HydraGraph resolves three direct callers (`scanSample`, `scanDocumentText`, and `scanDocumentFile`) plus four upstream `ScanView` handlers. `analyzeWithAI` also resolves its call to `src.data.languages.getLanguage`.

The graph also connects `src.context.DocumentContext.DocumentProvider.analyzeWithAI` to the `POST /api/analyze-document` route in `api/_backend.ts` through a `CALLS_API` relationship derived from the shared static URL string.

## Required MCP tools

- `find_callers(symbol)`: direct incoming `CALLS` relationships.
- `impact_of_change(symbol)`: bounded transitive reverse traversal.
- `explain_context(question)`: match a free-text question to a HydraDB symbol and return structured callers, callees, call-site evidence, and two-hop impact for the calling MCP agent to reason over.

## Progress tracker

| Milestone | Status | Evidence / next action |
|---|---|---|
| Verify HydraDB OSS API | Done | Official repo README/source checked; self-hosted endpoint is `POST /v1/graphs/{graph_id}/query`. |
| Choose real target | Corrected / done | `sayan365/docwise` is the sole target. Earlier Groundline/OpenDesk selection was mistaken and removed. |
| Set up tree-sitter | Done | `tree-sitter-typescript` parses `.ts` and `.tsx`; tests include Docwise’s recoverable JSX-text edge case. |
| Extract Docwise graph | Done | Dry run: 27 files, 92 nodes, 165 edges (`65 CONTAINS`, `45 IMPORTS`, `51 CALLS`, `4 CALLS_API`); six route nodes, 449 ordinary calls unresolved, zero static fetch paths unresolved. |
| Fresh public repository | Done | `sayan365/hydragraph-mcp`, first commit `0c1f711` on Aug 16. |
| Self-hosted HTTP smoke check | Done | Official container healthy on localhost; mutation/read round trip passed. |
| Ingest Docwise | Done | Generated graph replaced with 92 Docwise nodes and 165 relationships; live frontend/backend assertions pass. |
| Cross-service API dependency | Done | Live Cypher and MCP checks verify `analyzeWithAI -[:CALLS_API]-> POST /api/analyze-document` and two-hop reverse impact into all three scan functions. |
| MCP client integration | Automated check done | Stdio handshake exposes all three tools and a live Docwise `impact_of_change` call passes. Interactive demo remains. |
| Natural-language graph context | Done | Free-text schema, HydraDB symbol matching, caller/callee reuse, two-hop impact, explicit no-match response, and raw call-site evidence are implemented and exercised through a real MCP client. No external LLM dependency. |
| Smoke-data cleanup | Done | The two `HydraGraphSmoke` nodes were deleted from the live graph and the smoke writer/script was removed. |
| Demo and submission | Pending | Capture a real interactive refactor session and verify submission links. |

## Acceptance criteria

1. [x] HydraDB `/readyz` reports ready.
2. [x] HTTP mutation and `MATCH` round-trip succeeds.
3. [x] Docwise parses with explicit, evidence-backed edges.
4. [x] Live `find_callers(analyzeWithAI)` returns the three scan functions.
5. [x] Live `impact_of_change(analyzeWithAI)` returns the four upstream `ScanView` handlers.
6. [x] MCP stdio smoke check returns the same Docwise impact chain.
7. [x] A real `explain_context(question)` MCP call returns the matched symbol and structured graph evidence.
8. [x] A route question matches `POST /api/analyze-document` and crosses `CALLS_API` into frontend impact.
9. [ ] Capture a real interactive MCP client session.

## Risks and constraints

- Ambiguous/external calls remain unresolved; the demo must never rely on guessed edges.
- Tree-sitter recovery nodes are tolerated so one local TSX grammar limitation does not discard an otherwise useful file.
- HydraDB rejects `MERGE` followed by some clause shapes; ingestion uses tested batch statements and separate node/relationship writes.
- Development ports bind only to `127.0.0.1`; the startup script is not a production deployment configuration.
- The initial graph is single-repository by design. Multi-repo namespacing is out of hackathon scope.
- `explain_context` deliberately returns evidence rather than pre-synthesizing an answer; the calling MCP agent is responsible for reasoning over it.
- API matching handles only static string/template paths and `app`/`router` route registrations. It does not model dynamic URLs, path parameters, request methods at fetch sites, response schemas, or anonymous route-handler internals.
