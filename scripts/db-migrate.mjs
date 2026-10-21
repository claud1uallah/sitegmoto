import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { postgresConnectionOptions } from "./postgres-config.mjs";
try { process.loadEnvFile(".env.local"); } catch { /* Deployment injects environment. */ }
if (!process.env.DATABASE_URL) throw new Error("Configurează DATABASE_URL în .env.local sau în mediul serverului.");
const pool = new Pool(postgresConnectionOptions());
let client;
try {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(718124691234567::bigint)");
  await client.query("CREATE SCHEMA IF NOT EXISTS gtune");
  await client.query("CREATE TABLE IF NOT EXISTS gtune.schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const name of readdirSync("supabase/migrations").filter(n => /^\d+_[a-z0-9_]+\.sql$/.test(n)).sort()) {
    if ((await client.query("SELECT 1 FROM gtune.schema_migrations WHERE name=$1", [name])).rowCount) continue;
    await client.query(readFileSync(resolve("supabase/migrations", name), "utf8"));
    await client.query("INSERT INTO gtune.schema_migrations(name) VALUES($1)", [name]);
    console.log(`Applied ${name}`);
  }
  await client.query("COMMIT"); console.log("PostgreSQL migrations complete.");
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => {});
  console.error(`Migrarea PostgreSQL nu a fost aplicată (${error.code || "CONNECTION_ERROR"}). Verifică accesul de rețea, URI-ul pooler și parola.`);
  process.exitCode = 1;
} finally { client?.release(); await pool.end(); }
