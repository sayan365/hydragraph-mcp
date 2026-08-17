import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { ExplainContextService } from "./explain-context.js";
import { configFromEnvironment, HydraDbClient } from "./hydradb.js";

const client = new HydraDbClient(configFromEnvironment());
const explainer = new ExplainContextService(client);
const server = new McpServer({ name: "hydragraph", version: "0.1.0" });

server.tool(
  "find_callers",
  "Find code nodes that directly depend on an exact qualified symbol or HTTP route through CALLS or CALLS_API.",
  { symbol: z.string().describe("Qualified symbol or route, for example api._backend.route.POST./api/analyze-document") },
  async ({ symbol }) => result(await client.findCallers(symbol)),
);

server.tool(
  "impact_of_change",
  "Find the transitive blast radius of changing an exact qualified symbol or HTTP route across CALLS and CALLS_API edges.",
  { symbol: z.string().describe("Qualified symbol or route to trace backwards through dependency edges") },
  async ({ symbol }) => result(await client.impactOfChange(symbol)),
);

server.tool(
  "explain_context",
  "Given a natural-language question about the codebase, find the most relevant symbol and return its callers, callees, call-site evidence, and two-hop change impact from HydraDB. Use this structured graph data to answer the user's question yourself.",
  { question: z.string().min(1).describe("Free-text codebase question, for example: what happens if I change analyzeWithAI's return type?") },
  async ({ question }) => result(await explainer.answer(question)),
);

await server.connect(new StdioServerTransport());

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
