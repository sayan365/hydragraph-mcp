import { describe, expect, it } from "vitest";

import { buildGraph } from "../src/graph-builder.js";
import { PythonParser } from "../src/python-parser.js";

describe("PythonParser", () => {
  it("extracts classes, methods, functions, and calls with source evidence", () => {
    const parsed = new PythonParser().parse(`
def helper(value):
    return value

class Service:
    def run(self, value):
        return helper(value)
`, "service.py");
    const graph = buildGraph([parsed]);

    expect(parsed.symbols.map((item) => item.qualifiedName)).toEqual([
      "service.helper",
      "service.Service",
      "service.Service.run",
    ]);
    expect(graph.edges.some((edge) => edge.kind === "CALLS")).toBe(true);
  });
});
