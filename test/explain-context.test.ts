import { describe, expect, it, vi } from "vitest";

import { ExplainContextService, matchQuestionToSymbol, type GraphReader } from "../src/explain-context.js";
import type { GraphSymbol } from "../src/hydradb.js";

const analyze: GraphSymbol = {
  qualifiedName: "src.context.DocumentContext.DocumentProvider.analyzeWithAI",
  name: "analyzeWithAI",
  kind: "function",
  file: "src/context/DocumentContext.tsx",
  line: 140,
};

describe("ExplainContextService", () => {
  it("matches a natural-language question to a graph symbol", () => {
    expect(matchQuestionToSymbol("what breaks if I change analyzeWithAi?", [analyze])?.qualifiedName)
      .toBe(analyze.qualifiedName);
  });

  it("returns the matched symbol and raw two-hop graph evidence", async () => {
    const graph: GraphReader = {
      listSymbols: vi.fn().mockResolvedValue([analyze]),
      contextFor: vi.fn().mockResolvedValue({
        callers: [{ caller: "scanSample", file: "DocumentContext.tsx", line: 234, evidence: "DocumentContext.tsx:245 analyzeWithAI" }],
        callees: [{ callee: "getLanguage", file: "languages.ts", line: 18, evidence: "DocumentContext.tsx:162 getLanguage" }],
      }),
      impactOfChange: vi.fn().mockResolvedValue([{ symbol: "handleSampleClick", file: "ScanView.tsx", line: 26, depth: 2 }]),
    };
    const result = await new ExplainContextService(graph)
      .answer("what would break if I changed how analyzeWithAI works?");

    expect(graph.impactOfChange).toHaveBeenCalledWith(analyze.qualifiedName, 2);
    expect(result.matchedSymbol).toBe(analyze.qualifiedName);
    expect(result.callers).toHaveLength(1);
    expect(result.impact).toHaveLength(1);
  });

  it("returns an explicit no-match result without querying graph neighbors", async () => {
    const graph: GraphReader = {
      listSymbols: vi.fn().mockResolvedValue([analyze]),
      contextFor: vi.fn(),
      impactOfChange: vi.fn(),
    };

    const result = await new ExplainContextService(graph).answer("what controls the billing webhook?");

    expect(result.matchedSymbol).toBeNull();
    expect(result.note).toContain("No confident symbol match");
    expect(result.availableSymbols).toEqual([analyze.qualifiedName]);
    expect(graph.contextFor).not.toHaveBeenCalled();
  });
});
