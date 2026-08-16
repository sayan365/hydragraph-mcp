import type { GraphSymbol } from "./hydradb.js";

export interface GraphReader {
  listSymbols(): Promise<GraphSymbol[]>;
  contextFor(symbol: string): Promise<{ callers: Record<string, unknown>[]; callees: Record<string, unknown>[] }>;
  impactOfChange(symbol: string, maxDepth?: number): Promise<Record<string, unknown>[]>;
}

export interface ExplainContextResult {
  question: string;
  matchedSymbol: string | null;
  target: GraphSymbol | null;
  callers: Record<string, unknown>[];
  callees: Record<string, unknown>[];
  impact: Record<string, unknown>[];
  note?: string;
  availableSymbols?: string[];
}

export class ExplainContextService {
  constructor(private readonly graph: GraphReader) {}

  async answer(question: string): Promise<ExplainContextResult> {
    const symbols = (await this.graph.listSymbols()).filter((symbol) => symbol.kind !== "file");
    const target = matchQuestionToSymbol(question, symbols);
    if (!target) {
      return {
        question,
        matchedSymbol: null,
        target: null,
        callers: [],
        callees: [],
        impact: [],
        note: "No confident symbol match found for this question. Ask for a more specific function or method name.",
        availableSymbols: symbols.map((symbol) => symbol.qualifiedName).sort(),
      };
    }
    const [context, impact] = await Promise.all([
      this.graph.contextFor(target.qualifiedName),
      this.graph.impactOfChange(target.qualifiedName, 2),
    ]);
    return {
      question,
      matchedSymbol: target.qualifiedName,
      target,
      callers: context.callers,
      callees: context.callees,
      impact,
    };
  }
}

export function matchQuestionToSymbol(question: string, symbols: GraphSymbol[]): GraphSymbol | undefined {
  const compactQuestion = compact(question);
  const questionTokens = question.toLowerCase().split(/[^a-z0-9_$]+/).filter(Boolean);
  return symbols
    .map((symbol) => ({ symbol, score: symbolScore(symbol, compactQuestion, questionTokens) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.symbol.name.length - left.symbol.name.length)[0]?.symbol;
}

function symbolScore(symbol: GraphSymbol, compactQuestion: string, questionTokens: string[]): number {
  const name = compact(symbol.name);
  const qualifiedName = compact(symbol.qualifiedName);
  if (qualifiedName.length >= 4 && compactQuestion.includes(qualifiedName)) return 300 + qualifiedName.length;
  if (name.length >= 4 && compactQuestion.includes(name)) return 200 + name.length;
  const nearest = Math.min(...questionTokens.map((token) => editDistance(name, compact(token))), Number.POSITIVE_INFINITY);
  const allowedDistance = name.length >= 10 ? 2 : name.length >= 6 ? 1 : 0;
  return nearest <= allowedDistance ? 100 - nearest : 0;
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_$]/g, "");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}
