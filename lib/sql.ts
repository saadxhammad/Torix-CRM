import postgres from "postgres";
import { env } from "./runtime-env";

export type SqlResult = {
  results: any[];
  meta: { changes: number };
};

export type SqlStatement = {
  sql: string;
  args: any[];
  bind: (...a: any[]) => SqlStatement;
  first: () => Promise<any | null>;
  all: () => Promise<SqlResult>;
  run: () => Promise<SqlResult>;
};

let sql: ReturnType<typeof postgres> | null = null;

function client() {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing. Add your Supabase Postgres connection string to .env.local",
    );
  }
  if (!sql) {
    sql = postgres(env.DATABASE_URL, {
      prepare: false,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 30,
    });
  }
  return sql;
}

/** Convert D1-style `?` placeholders to Postgres `$1`, `$2`, … */
function toPg(sqlText: string) {
  let n = 0;
  return sqlText
    .replace(/INSERT OR IGNORE INTO/gi, "INSERT INTO")
    .replace(/\?/g, () => `$${++n}`);
}

function appendConflict(sqlText: string) {
  // SQLite INSERT OR IGNORE → Postgres ON CONFLICT DO NOTHING when no clause present
  if (/^INSERT INTO/i.test(sqlText) && !/ON CONFLICT/i.test(sqlText)) {
    return sqlText + " ON CONFLICT DO NOTHING";
  }
  return sqlText;
}

function statement(rawSql: string, args: any[] = []): SqlStatement {
  const self: SqlStatement = {
    sql: rawSql,
    args,
    bind(...a: any[]) {
      return statement(rawSql, a);
    },
    async first() {
      const rows = await client().unsafe(toPg(appendConflict(rawSql)), args);
      return rows[0] || null;
    },
    async all() {
      const rows = await client().unsafe(toPg(appendConflict(rawSql)), args);
      return { results: [...rows], meta: { changes: 0 } };
    },
    async run() {
      const rows = (await client().unsafe(toPg(appendConflict(rawSql)), args)) as any;
      const changes = Number(rows?.count ?? (Array.isArray(rows) ? rows.length : 0));
      return {
        results: Array.isArray(rows) ? [...rows] : [],
        meta: { changes },
      };
    },
  };
  return self;
}

/**
 * D1-compatible database surface used across Torix server code.
 * Backed by Supabase Postgres (DATABASE_URL).
 */
export function createDatabase() {
  return {
    prepare(sqlText: string) {
      return statement(sqlText);
    },
    async batch(statements: SqlStatement[]) {
      const db = client();
      const results: SqlResult[] = [];
      await db.begin(async (tx) => {
        for (const s of statements) {
          const pgSql = toPg(appendConflict(s.sql));
          const rows = (await tx.unsafe(pgSql, s.args)) as any;
          const changes = Number(rows?.count ?? (Array.isArray(rows) ? rows.length : 0));
          results.push({
            results: Array.isArray(rows) ? [...rows] : [],
            meta: { changes },
          });
        }
      });
      return results;
    },
  };
}

export type Database = ReturnType<typeof createDatabase>;
