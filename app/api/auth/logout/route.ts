import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await clearSessionCookie();
  const returnTo = new URL(request.url).searchParams.get("return_to") || "/login";
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/login";
  return NextResponse.redirect(new URL(safe, request.url));
}

export async function POST(request: Request) {
  return GET(request);
}
