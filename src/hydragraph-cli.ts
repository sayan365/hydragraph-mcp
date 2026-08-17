import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import minimist from "minimist";

import { configFromEnvironment, HydraDbClient } from "./hydradb.js";

const usage = "Usage: hydragraph <init | add <path> | mcp>";

try {
  const args = minimist(process.argv.slice(2), { boolean: ["help"], alias: { h: "help" } });
  const [command, argument, ...extra] = args._;

  if (args.help) {
    console.log(usage);
  } else if (command === "init" && argument === undefined && extra.length === 0) {
    await initialize();
  } else if (command === "add" && typeof argument === "string" && extra.length === 0) {
    process.argv = [process.execPath, resolve("src", "cli.ts"), argument];
    await import("./cli.js");
  } else if (command === "mcp" && argument === undefined && extra.length === 0) {
    await import("./server.js");
  } else {
    throw new Error(usage);
  }
} catch (error) {
  console.error(`HydraGraph failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function initialize(): Promise<void> {
  const config = configFromEnvironment();
  const client = new HydraDbClient(config);
  await client.query("MATCH (n:CodeNode {qualified_name: $symbol}) RETURN n.qualified_name AS symbol", {
    symbol: "__hydragraph_reachability_check__",
  });
  console.log(`HydraDB reachable: ${config.url}`);

  const directory = resolve(process.cwd(), ".hydragraph");
  const path = resolve(directory, "config.json");
  if (existsSync(path)) {
    console.log(`Config already exists: ${path}`);
  } else {
    await mkdir(directory, { recursive: true });
    await writeFile(path, `${JSON.stringify({
      url: config.url,
      token: config.token,
      namespace: config.namespace,
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(`Created config: ${path}`);
  }
  console.log("HydraGraph initialized.");
}
