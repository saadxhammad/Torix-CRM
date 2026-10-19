/** App env — works on Node (Vercel/local). No Cloudflare bindings. */
export const env = {
  get DATABASE_URL() {
    return process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "";
  },
  get SUPABASE_URL() {
    return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  },
  get SUPABASE_ANON_KEY() {
    return (
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      ""
    );
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  },
  get SUPABASE_STORAGE_BUCKET() {
    return process.env.SUPABASE_STORAGE_BUCKET || "torix-files";
  },
  get TORIX_OWNER_EMAIL() {
    return process.env.TORIX_OWNER_EMAIL || "";
  },
  get TORIX_OWNER_ID() {
    return process.env.TORIX_OWNER_ID || "torix-owner";
  },
  get TORIX_OWNER_PASSWORD() {
    return process.env.TORIX_OWNER_PASSWORD || "";
  },
  get TORIX_STAFF_PASSWORD() {
    return process.env.TORIX_STAFF_PASSWORD || process.env.TORIX_OWNER_PASSWORD || "";
  },
  get AUTH_SECRET() {
    return process.env.AUTH_SECRET || process.env.TORIX_OWNER_PASSWORD || "dev-only-change-me";
  },
};
