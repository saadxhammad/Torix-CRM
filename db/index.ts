import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/runtime-env";
import * as schema from "./schema";

export function getDb() {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is unavailable. Set your Supabase Postgres connection string.",
    );
  }
  const client = postgres(env.DATABASE_URL, { prepare: false });
  return drizzle(client, { schema });
}
