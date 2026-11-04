/**
 * Edge-compatible session verify for middleware (Web Crypto HMAC-SHA256).
 * Must match Node createHmac(...).digest("base64url") in lib/session.ts.
 */
import {
  parseSessionPayload,
  SESSION_COOKIE,
  type SessionUser,
} from "./session-shared";

function b64urlEncode(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqualStr(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function signEdge(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64urlEncode(sig);
}

/** Decode base64url JSON body (padding-safe). */
function decodeBodyJson(body: string) {
  const padded = body.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return JSON.parse(atob(padded + pad));
}

export async function decodeSessionEdge(
  token: string | undefined | null,
  secret: string,
): Promise<SessionUser | null> {
  if (!token || !secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await signEdge(body, secret);
  if (!timingSafeEqualStr(sig, expected)) return null;
  try {
    return parseSessionPayload(decodeBodyJson(body));
  } catch {
    return null;
  }
}

export { SESSION_COOKIE };
