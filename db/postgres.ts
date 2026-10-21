import { Pool, type PoolClient, type QueryResultRow } from "pg";

type Parameters = unknown[];
export type DatabaseResult<T = Record<string, unknown>> = { results: T[]; meta: { changes: number } };
export interface PreparedStatement {
  bind(...values: unknown[]): PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<DatabaseResult>;
}
export interface StoreDatabase { prepare(sql: string): PreparedStatement; batch(statements: PreparedStatement[]): Promise<DatabaseResult[]> }
export type SqlClient = { query(sql: string, values?: any[]): Promise<{ rows: QueryResultRow[]; rowCount?: number | null }>; release(): void };
export type SqlPool = { connect(): Promise<SqlClient>; query(sql: string, values?: any[]): Promise<{ rows: QueryResultRow[]; rowCount?: number | null }> };

// Keep the service's parameterized statement API while using PostgreSQL SQL.
// These explicit conversions cover the small, tested legacy SQL vocabulary.
export function postgresSql(source: string): string {
  let sql = source;
  const ignore = /^\s*INSERT OR IGNORE\b/i.test(sql);
  sql = sql.replace(/\bINSERT OR IGNORE\b/gi, "INSERT");
  sql = sql.replace(/json_array\(price,variants\)\s*=\s*\?/g, "jsonb_build_array(price,variants) = ?::jsonb");
  sql = sql.replace(/json_each\(compatibility\)/g, "jsonb_array_elements_text(compatibility::jsonb) AS compatibility_value(value)");
  sql = sql.replace(/json_each\(orders\.items\)\s+AS\s+line/gi, "jsonb_array_elements(orders.items::jsonb) AS line(value)");
  sql = sql.replace(/json_extract\(line\.value,'\$\.productId'\)/g, "(line.value->>'productId')");
  sql = sql.replace(/json_extract\(customer,'\$\.(name|phone)'\)/g, "(customer::jsonb->>'$1')");
  sql = sql.replace(/\bMAX\(0,/g, "GREATEST(0,");
  sql = sql.replace(/SET count=count\+1/g, "SET count=rate_limits.count+1");
  sql = sql.replace(/\bAS\s+([a-zA-Z_][a-zA-Z0-9_]*[A-Z][a-zA-Z0-9_]*)\b/g, 'AS "$1"');
  sql = sql.replace(/\b(ORDER BY|GROUP BY)\s+([a-z][a-zA-Z0-9_]*[A-Z][a-zA-Z0-9_]*)\b/g, '$1 "$2"');
  if (ignore) sql += " ON CONFLICT DO NOTHING";
  // Only replace placeholders outside quoted SQL literals/identifiers.
  let index = 0, quoted = false, identifier = false, result = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" && !identifier) { result += c; if (quoted && sql[i + 1] === "'") { result += sql[++i]; continue; } quoted = !quoted; continue; }
    if (c === '"' && !quoted) identifier = !identifier;
    result += c === "?" && !quoted && !identifier ? `$${++index}` : c;
  }
  return result;
}

function normalize<T>(rows: QueryResultRow[]): T[] { return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]))) as T[]; }
class Statement implements PreparedStatement {
  constructor(readonly owner: PostgresDatabase, readonly sql: string, readonly values: Parameters = []) {}
  bind(...values: unknown[]) { return new Statement(this.owner, this.sql, values); }
  all<T>() { return this.owner.execute<T>(this); }
  async first<T>() { return (await this.all<T>()).results[0] ?? null; }
  run() { return this.all<Record<string, unknown>>(); }
}
export class PostgresDatabase implements StoreDatabase {
  constructor(readonly pool: SqlPool) {}
  prepare(sql: string) { return new Statement(this, sql); }
  async execute<T>(statement: Statement): Promise<DatabaseResult<T>> {
    if (/^\s*(SELECT|WITH)\b/i.test(statement.sql)) {
      const client = await this.pool.connect();
      try { await client.query("SET search_path TO gtune,pg_catalog"); const result = await client.query(postgresSql(statement.sql), statement.values); return { results: normalize<T>(result.rows), meta: { changes: result.rowCount ?? 0 } }; } finally { client.release(); }
    }
    return (await this.batch([statement]))[0] as DatabaseResult<T>;
  }
  async batch(statements: PreparedStatement[]): Promise<DatabaseResult[]> {
    if (!statements.every(s => s instanceof Statement && s.owner === this)) throw new Error("Statement belongs to another database");
    for (let attempt = 0; ; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL search_path TO gtune,pg_catalog");
        // Every service mutation takes the same transaction-scoped lock. This
        // preserves atomic conditional stock/coupon/order batches across servers.
        await client.query("SELECT pg_advisory_xact_lock(718124691234567::bigint)");
        const results: DatabaseResult[] = [];
        for (const statement of statements as Statement[]) { const result = await client.query(postgresSql(statement.sql), statement.values); results.push({ results: normalize(result.rows), meta: { changes: result.rowCount ?? 0 } }); }
        await client.query("COMMIT"); return results;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { /* Connection is discarded by pg on failure. */ }
        if (attempt < 2 && ["40001", "40P01"].includes(String((error as { code?: string }).code))) continue;
        throw error;
      } finally { client.release(); }
    }
  }
}

declare global { var gtunePostgresPool: Pool | undefined; }
export function postgresPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  const url = new URL(process.env.DATABASE_URL);
  for (const parameter of ["sslmode","sslcert","sslkey","sslrootcert"]) url.searchParams.delete(parameter);
  const pool = globalThis.gtunePostgresPool ??= new Pool({ connectionString: url.href, max: 5, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30000, statement_timeout: 15000, application_name: "gtune-store", ssl: process.env.DATABASE_SSL === "disable" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname) ? false : { rejectUnauthorized: true, ...(process.env.DATABASE_SSL_CA ? { ca: process.env.DATABASE_SSL_CA.replace(/\\n/g,"\n") } : {}) }, options: "-c search_path=gtune,pg_catalog" });
  return pool;
}
export function getStoreDatabase() { return new PostgresDatabase(postgresPool() as unknown as SqlPool); }
