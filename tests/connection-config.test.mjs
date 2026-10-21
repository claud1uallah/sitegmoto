import test from "node:test";
import assert from "node:assert/strict";
import { postgresConnectionOptions } from "../scripts/postgres-config.mjs";

test("remote database cannot disable certificate verification through URI or environment", () => {
  const config = postgresConnectionOptions({ DATABASE_URL: "postgresql://user:example@db.example.test/postgres?sslmode=no-verify&sslrootcert=untrusted", DATABASE_SSL: "disable" });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(new URL(config.connectionString).search, "");
});
test("local development can explicitly disable TLS", () => {
  const config = postgresConnectionOptions({ DATABASE_URL: "postgresql://user:example@127.0.0.1/postgres", DATABASE_SSL: "disable" });
  assert.equal(config.ssl, false);
});
test("trusted CA supports environment newline encoding", () => {
  const config = postgresConnectionOptions({ DATABASE_URL: "postgresql://user:example@db.example.test/postgres", DATABASE_SSL_CA: "first\\nsecond" });
  assert.equal(config.ssl.ca, "first\nsecond");
});
