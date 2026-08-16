import { configFromEnvironment, HydraDbClient } from "./hydradb.js";

const client = new HydraDbClient(configFromEnvironment());
const firstId = 8_000_000_000_001;
const secondId = 8_000_000_000_002;

await client.query(
  "UNWIND $rows AS row MERGE (n {id: row.id}) SET n:HydraGraphSmoke, n.name = row.name",
  {
    rows: [
      { id: firstId, name: "hydragraph-smoke-source" },
      { id: secondId, name: "hydragraph-smoke-target" },
    ],
  },
);

await client.query(
  "UNWIND $rows AS row MATCH (a:HydraGraphSmoke {id: row.source}), (b:HydraGraphSmoke {id: row.target}) MERGE (a)-[r:CONNECTS {id: row.edge}]->(b)",
  { rows: [{ source: firstId, target: secondId, edge: 8_000_000_000_003 }] },
);

const response = await client.query(
  "MATCH (a:HydraGraphSmoke {id: $first})-[:CONNECTS]->(b:HydraGraphSmoke) RETURN b.name AS name",
  { first: firstId },
);

const value = response.rows[0]?.[0]?.value;
if (value !== "hydragraph-smoke-target") {
  throw new Error(`HydraDB smoke check returned ${JSON.stringify(value)}`);
}

console.log("HydraDB HTTP write/read smoke check passed.");
