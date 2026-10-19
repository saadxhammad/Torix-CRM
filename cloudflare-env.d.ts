declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    TORIX_OWNER_EMAIL?: string;
    TORIX_OWNER_ID?: string;
  }
}
