import { NextResponse, type NextRequest } from "next/server";
import { decodeSessionEdge, SESSION_COOKIE } from "@/lib/session-edge";
import { homePathForRole, isEmployeePortalRole } from "@/lib/session-shared";

const PUBLIC = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

function authSecret() {
  return process.env.AUTH_SECRET || process.env.TORIX_OWNER_PASSWORD || "dev-only-change-me";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(?:png|jpg|jpeg|gif|svg|ico|css|js|map|txt|webp)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC.has(pathname) || pathname.startsWith("/api/auth/");
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = await decodeSessionEdge(token, authSecret());

  if (isPublic) {
    if (user && pathname === "/login") {
      return NextResponse.redirect(new URL(homePathForRole(user.role), request.url));
    }
    return NextResponse.next();
  }

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sign in to use Torix Solutions." }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("return_to", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  // Sessions created before role was stored must sign in again.
  if (!user.role) {
    const login = new URL("/login", request.url);
    login.searchParams.set("return_to", pathname.startsWith("/api/") ? "/" : pathname);
    const res = NextResponse.redirect(login);
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  const staff = isEmployeePortalRole(user.role);

  if (staff && (pathname === "/" || pathname === "")) {
    return NextResponse.redirect(new URL("/portal", request.url));
  }
  if (!staff && pathname.startsWith("/portal")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
