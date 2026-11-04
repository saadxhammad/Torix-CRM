import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const PREFIX = "scrypt";
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEYLEN).toString("hex");
  return `${PREFIX}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;
  const [, salt, expected] = parts;
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, KEYLEN).toString("hex");
  try {
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function validateLoginPassword(password: string, { required = false } = {}) {
  const value = String(password || "");
  if (!value) {
    if (required) throw new Error("Set a login password for this employee.");
    return "";
  }
  if (value.length < 8) throw new Error("Login password must be at least 8 characters.");
  if (value.length > 128) throw new Error("Login password is too long.");
  return value;
}

/** Best-effort column for existing Supabase deployments. */
export async function ensureMemberPasswordColumn(db: {
  prepare: (sql: string) => { run: () => Promise<any> };
}) {
  try {
    await db.prepare("ALTER TABLE company_members ADD COLUMN IF NOT EXISTS password_hash text").run();
  } catch {
    /* column may already exist or dialect may differ */
  }
}
