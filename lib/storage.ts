import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./runtime-env";

function admin(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bucketName() {
  return env.SUPABASE_STORAGE_BUCKET;
}

/** R2-compatible object storage backed by Supabase Storage. */
export function createBucket() {
  return {
    async put(
      key: string,
      value: ArrayBuffer | Uint8Array | string,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      const body =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : value;
      const { error } = await admin().storage.from(bucketName()).upload(key, body, {
        upsert: true,
        contentType: options?.httpMetadata?.contentType || "application/octet-stream",
      });
      if (error) throw new Error(error.message || "Upload failed");
    },
    async get(key: string) {
      const { data, error } = await admin().storage.from(bucketName()).download(key);
      if (error || !data) return null;
      const buffer = await data.arrayBuffer();
      return {
        body: buffer,
        async text() {
          return new TextDecoder().decode(buffer);
        },
      };
    },
    async delete(key: string) {
      await admin().storage.from(bucketName()).remove([key]);
    },
  };
}

export type Bucket = ReturnType<typeof createBucket>;
