import { Pool } from "pg";
import { postgresConnectionOptions } from "./postgres-config.mjs";
try { process.loadEnvFile(".env.local"); } catch {}
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL lipsește."); process.exit(1); }
const pool = new Pool(postgresConnectionOptions());
try { const result = await pool.query("SELECT current_database() AS database, current_schema() AS schema, version() AS version"); console.log(JSON.stringify({ connected: true, database: result.rows[0].database, postgres: result.rows[0].version.split(" ").slice(0, 2).join(" ") })); }
catch (error) { console.error(JSON.stringify({ connected: false, code: error.code || "CONNECTION_ERROR", reason: error.code === "28P01" ? "Serverul PostgreSQL este accesibil, dar respinge autentificarea. Verifică utilizatorul și parola bazei." : "Conexiunea SQL nu a putut fi validată. Verifică URI-ul Session pooler, certificatul CA și accesul de rețea." })); process.exitCode = 1; }
finally { await pool.end(); }
