import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { configFromEnvironment, HydraDbClient } from "./hydradb.js";

const client = new HydraDbClient(configFromEnvironment());
const server = new McpServer({ name: "hydragraph", version: "0.1.0" });

server.tool(
  "find_callers",
  "Find functions or methods that directly call an exact fully-qualified TypeScript symbol.",
  { symbol: z.string().describe("Fully-qualified symbol, for example src.context.DocumentContext.DocumentProvider.analyzeWithAI") },
  async ({ symbol }) => result(await client.findCallers(symbol)),
);

server.tool(
  "impact_of_change",
  "Find the transitive blast radius of changing an exact fully-qualified TypeScript symbol.",
  { symbol: z.string().describe("Fully-qualified symbol to trace backwards through CALLS edges") },
  async ({ symbol }) => result(await client.impactOfChange(symbol)),
);

server.tool(
  "explain_context",
  "Return graph-grounded neighboring symbols and source locations for a symbol. Use these citations to explain the code in the MCP client's own model.",
  { symbol: z.string().describe("Fully-qualified symbol whose structural context is needed") },
  async ({ symbol }) => result(await client.contextFor(symbol)),
);

await server.connect(new StdioServerTransport());

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
