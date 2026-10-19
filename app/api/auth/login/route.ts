import { NextResponse } from "next/server";
import { env } from "@/lib/runtime-env";
import { setSessionCookie } from "@/lib/session";
import { createDatabase } from "@/lib/sql";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const ownerEmail = env.TORIX_OWNER_EMAIL.toLowerCase();
    if (!ownerEmail || !env.TORIX_OWNER_PASSWORD) {
      return NextResponse.json(
        { error: "Server login is not configured. Set TORIX_OWNER_EMAIL and TORIX_OWNER_PASSWORD." },
        { status: 500 },
      );
    }

    let userId = "";
    let displayName = email;

    if (email === ownerEmail) {
      if (password !== env.TORIX_OWNER_PASSWORD) {
        return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
      }
      userId = env.TORIX_OWNER_ID;
      displayName = "Owner";
    } else {
      if (!env.TORIX_STAFF_PASSWORD || password !== env.TORIX_STAFF_PASSWORD) {
        return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
      }
      const db = createDatabase();
      const member = await db
        .prepare(
          "SELECT id, email, user_id, role, active FROM company_members WHERE company_id=? AND email=? AND active=1",
        )
        .bind("torix-solutions", email)
        .first();
      if (!member) {
        return NextResponse.json(
          { error: "This email has not been granted workspace access yet." },
          { status: 403 },
        );
      }
      userId = member.user_id || `member-${member.id}`;
      displayName = member.role || email;
    }

    await setSessionCookie({
      userId,
      email,
      displayName,
      fullName: displayName,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Login failed." },
      { status: 500 },
    );
  }
}
