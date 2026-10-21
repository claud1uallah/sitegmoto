export function postgresConnectionOptions(env = process.env) {
  const url = new URL(env.DATABASE_URL);
  for (const parameter of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(parameter);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return {
    connectionString: url.href,
    ssl: env.DATABASE_SSL === "disable" && local ? false : {
      rejectUnauthorized: true,
      ...(env.DATABASE_SSL_CA ? { ca: env.DATABASE_SSL_CA.replace(/\\n/g, "\n") } : {}),
    },
    connectionTimeoutMillis: 8000,
    max: 1,
  };
}
