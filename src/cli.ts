import { buildGraph } from "./graph-builder.js";
import { configFromEnvironment, HydraDbClient } from "./hydradb.js";
import { parsePythonRepository } from "./repository.js";

const repository = process.argv[2] ?? process.env.HYDRAGRAPH_REPO_PATH;
if (!repository) throw new Error("Usage: npm run index -- <path-to-python-repository>");

const parsed = await parsePythonRepository(repository);
const graph = buildGraph(parsed);
const edgeCounts = Object.fromEntries(
  ["CONTAINS", "IMPORTS", "CALLS"].map((kind) => [kind, graph.edges.filter((edge) => edge.kind === kind).length]),
);
console.error(
  `Parsed ${parsed.length} files, ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
  `(${edgeCounts.CONTAINS} CONTAINS, ${edgeCounts.IMPORTS} IMPORTS, ${edgeCounts.CALLS} CALLS; ` +
  `${graph.unresolvedCalls.length} external or ambiguous calls left unresolved).`,
);

if (process.argv.includes("--dry-run")) {
  process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
} else {
  await new HydraDbClient(configFromEnvironment()).ingest(graph);
  console.error("HydraDB ingestion complete.");
}
