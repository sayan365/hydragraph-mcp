import { buildGraph } from "./graph-builder.js";
import { configFromEnvironment, HydraDbClient } from "./hydradb.js";
import { parseRepository } from "./repository.js";

const repository = process.argv[2] ?? process.env.HYDRAGRAPH_REPO_PATH;
if (!repository) throw new Error("Usage: npm run index -- <path-to-typescript-repository>");

const parsed = await parseRepository(repository);
const graph = buildGraph(parsed);
const edgeCounts = Object.fromEntries(
  ["CONTAINS", "IMPORTS", "CALLS", "CALLS_API"].map((kind) => [kind, graph.edges.filter((edge) => edge.kind === kind).length]),
);
console.error(
  `Parsed ${parsed.length} files, ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
  `(${edgeCounts.CONTAINS} CONTAINS, ${edgeCounts.IMPORTS} IMPORTS, ${edgeCounts.CALLS} CALLS, ${edgeCounts.CALLS_API} CALLS_API; ` +
  `${graph.unresolvedCalls.length} external or ambiguous calls and ${graph.unresolvedApiCalls.length} static fetch calls left unresolved).`,
);

if (process.argv.includes("--dry-run")) {
  process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
} else {
  await new HydraDbClient(configFromEnvironment()).replaceCodeGraph(graph);
  console.error("HydraDB replacement ingestion complete.");
}
