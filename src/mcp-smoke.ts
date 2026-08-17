import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/src/server.js"],
  env: {
    ...process.env,
    HYDRADB_TOKEN: process.env.HYDRADB_TOKEN ?? "local-development-token-32-bytes",
  },
});
const client = new Client({ name: "hydragraph-smoke-client", version: "0.1.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  for (const expected of ["explain_context", "find_callers", "impact_of_change"]) {
    if (!names.includes(expected)) throw new Error(`MCP server did not expose ${expected}: ${names.join(", ")}`);
  }
  const explainTool = tools.tools.find((tool) => tool.name === "explain_context");
  const explainProperties = explainTool?.inputSchema.properties ?? {};
  if (!("question" in explainProperties) || "symbol" in explainProperties) {
    throw new Error(`explain_context did not expose the natural-language question schema: ${JSON.stringify(explainTool?.inputSchema)}`);
  }

  const response = await client.callTool({
    name: "impact_of_change",
    arguments: { symbol: "src.context.DocumentContext.DocumentProvider.analyzeWithAI" },
  });
  const payload = JSON.stringify(response.content);
  if (!payload.includes("src.components.ScanView.ScanView.handlePasteSubmit")) {
    throw new Error(`MCP impact response lacked ScanView.handlePasteSubmit: ${payload}`);
  }

  const explanation = await client.callTool({
    name: "explain_context",
    arguments: { question: "what would break in the frontend if the /api/analyze-document response format changed?" },
  });
  const explanationPayload = JSON.stringify(explanation.content);
  if (
    !explanationPayload.includes("api._backend.route.POST./api/analyze-document") ||
    !explanationPayload.includes("src.context.DocumentContext.DocumentProvider.analyzeWithAI") ||
    !explanationPayload.includes("CALLS_API")
  ) {
    throw new Error(`MCP explanation lacked the route, frontend caller, or CALLS_API evidence: ${explanationPayload}`);
  }

  console.log(`MCP stdio smoke check passed (${names.join(", ")}).`);
} finally {
  await client.close();
}
