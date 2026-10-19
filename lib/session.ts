import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./runtime-env";

export type SessionUser = {
  userId: string;
  email: string;
  displayName: string;
  fullName: string | null;
};

const COOKIE = "torix_session";

function sign(payload: string) {
  return createHmac("sha256", env.AUTH_SECRET).update(payload).digest("base64url");
}

export function encodeSession(user: SessionUser) {
  const body = Buffer.from(JSON.stringify(user), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const user = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!user?.userId || !user?.email) return null;
    return {
      userId: String(user.userId),
      email: String(user.email).toLowerCase(),
      displayName: String(user.displayName || user.email),
      fullName: user.fullName ? String(user.fullName) : null,
    };
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return decodeSession(jar.get(COOKIE)?.value);
}

export async function setSessionCookie(user: SessionUser) {
  const jar = await cookies();
  jar.set(COOKIE, encodeSession(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export { COOKIE as SESSION_COOKIE };
