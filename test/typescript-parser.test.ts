import { describe, expect, it } from "vitest";

import { buildGraph } from "../src/graph-builder.js";
import { TypeScriptParser } from "../src/typescript-parser.js";

describe("TypeScriptParser", () => {
  it("extracts functions, arrow functions, classes, methods, and calls", () => {
    const parsed = new TypeScriptParser().parse(`
export function helper(value: string) { return value; }
export const run = () => helper("value");
class Service { execute() { return helper("service"); } }
`, "service.ts");
    const graph = buildGraph([parsed]);
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const calls = graph.edges
      .filter((edge) => edge.kind === "CALLS")
      .map((edge) => [byId.get(edge.source)?.qualifiedName, byId.get(edge.target)?.qualifiedName]);

    expect(parsed.symbols.map((item) => item.qualifiedName)).toEqual([
      "service.helper",
      "service.run",
      "service.Service",
      "service.Service.execute",
    ]);
    expect(calls).toContainEqual(["service.run", "service.helper"]);
    expect(calls).toContainEqual(["service.Service.execute", "service.helper"]);
  });

  it("parses TSX component arrows", () => {
    const parsed = new TypeScriptParser().parse(`
export const Button: React.FC = () => <button onClick={() => submit()}>Go</button>;
function submit() { return true; }
`, "Button.tsx", true);

    expect(parsed.symbols.map((item) => item.name)).toContain("Button");
    expect(buildGraph([parsed]).edges.some((edge) => edge.kind === "CALLS")).toBe(true);
  });

  it("keeps useful symbols when TSX contains a recoverable grammar error", () => {
    const parsed = new TypeScriptParser().parse(`
export const Insights = () => <p>Documents & legal risk trends.</p>;
`, "Insights.tsx", true);

    expect(parsed.symbols.map((item) => item.qualifiedName)).toContain("Insights.Insights");
  });

  it("connects a static fetch call to a matching Express route", () => {
    const frontend = new TypeScriptParser().parse(`
export async function analyzeWithAI() {
  return fetch('/api/analyze-document', { method: 'POST' });
}
`, "src/context/DocumentContext.tsx", true);
    const backend = new TypeScriptParser().parse(`
function analyzeHandler() { return true; }
app.post('/api/analyze-document', analyzeHandler);
`, "api/_backend.ts");
    const graph = buildGraph([frontend, backend]);
    const route = graph.nodes.find((node) => node.kind === "route");
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const apiEdge = graph.edges.find((edge) => edge.kind === "CALLS_API");

    expect(route).toMatchObject({
      name: "POST /api/analyze-document",
      httpMethod: "POST",
      routePath: "/api/analyze-document",
      handlerQualifiedName: "api._backend.analyzeHandler",
    });
    expect(byId.get(apiEdge?.source ?? 0)?.qualifiedName).toBe("src.context.DocumentContext.analyzeWithAI");
    expect(byId.get(apiEdge?.target ?? 0)?.qualifiedName).toBe(route?.qualifiedName);
    expect(graph.unresolvedApiCalls).toEqual([]);
  });
});
