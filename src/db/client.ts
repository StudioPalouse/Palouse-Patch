import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";
import { config } from "../server/config.ts";

export const sql = postgres(config.databaseUrl, { max: config.databasePoolSize });
export const db = drizzle(sql, { schema, casing: "snake_case" });
export type DB = typeof db;
