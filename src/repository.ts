import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ParsedFile } from "./model.js";
import { PythonParser } from "./python-parser.js";

const SKIPPED_DIRECTORIES = new Set([".git", ".venv", "venv", "node_modules", "__pycache__", "dist", "build"]);

export async function parsePythonRepository(root: string): Promise<ParsedFile[]> {
  const absoluteRoot = path.resolve(root);
  const files = await walk(absoluteRoot);
  const parser = new PythonParser();
  return Promise.all(files.filter((file) => file.endsWith(".py")).map(async (file) => {
    const relativePath = path.relative(absoluteRoot, file).replaceAll("\\", "/");
    return parser.parse(await readFile(file, "utf8"), relativePath);
  }));
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() ? [fullPath] : [];
  }));
  return nested.flat();
}
