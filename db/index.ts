import { drizzle } from "drizzle-orm/node-postgres";
import { postgresPool } from "./postgres";
import * as schema from "./schema";

export function getDb() {
  return drizzle(postgresPool(), { schema });
}
