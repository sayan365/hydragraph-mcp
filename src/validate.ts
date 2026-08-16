import { configFromEnvironment, HydraDbClient } from "./hydradb.js";

const client = new HydraDbClient(configFromEnvironment());
const analyze = "src.context.DocumentContext.DocumentProvider.analyzeWithAI";
const scanSample = "src.context.DocumentContext.DocumentProvider.scanSample";
const scanText = "src.context.DocumentContext.DocumentProvider.scanDocumentText";
const scanFile = "src.context.DocumentContext.DocumentProvider.scanDocumentFile";

const callers = await client.findCallers(analyze);
for (const expected of [scanSample, scanText, scanFile]) {
  assertIncludes(callers, "caller", expected, "direct callers of analyzeWithAI");
}
assertExcludes(callers, "caller", analyze, "direct callers of analyzeWithAI");

const impact = await client.impactOfChange(analyze);
for (const expected of [
  "src.components.ScanView.ScanView.handleSampleClick",
  "src.components.ScanView.ScanView.handleFileChange",
  "src.components.ScanView.ScanView.handleDrop",
  "src.components.ScanView.ScanView.handlePasteSubmit",
]) {
  assertIncludes(impact, "symbol", expected, "impact of analyzeWithAI");
}

const context = await client.contextFor(analyze);
assertIncludes(context.callees, "callee", "src.data.languages.getLanguage", "callees of analyzeWithAI");

console.log(JSON.stringify({ analyze, callers, impact, analyzeContext: context }, null, 2));
console.error("Live HydraDB graph validation passed.");

function assertIncludes(rows: Record<string, unknown>[], field: string, expected: string, label: string): void {
  if (!rows.some((row) => row[field] === expected)) {
    throw new Error(`${label} did not include ${expected}: ${JSON.stringify(rows)}`);
  }
}

function assertExcludes(rows: Record<string, unknown>[], field: string, unexpected: string, label: string): void {
  if (rows.some((row) => row[field] === unexpected)) {
    throw new Error(`${label} unexpectedly included ${unexpected}: ${JSON.stringify(rows)}`);
  }
}
