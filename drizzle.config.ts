import { defineConfig } from "drizzle-kit";
try { process.loadEnvFile(".env.local"); } catch { /* Production injects environment. */ }

export default defineConfig({
  out: "./drizzle-postgres",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL || "" },
  schemaFilter: ["gtune"],
});
