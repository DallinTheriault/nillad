import { NextRequest, NextResponse } from "next/server";

// Middleware can't access better-sqlite3 (Node-only module), so we do a
// lightweight cookie-presence check here and let the page-level auth
// (lib/auth.ts) do the cryptographic verification on the server.
const COOKIE_NAME = "nf_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Allow login, framework assets, the manifest, and static brand files through.
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/briefing") || // own key-gate; called by the n8n cron, no session cookie
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/manifest.webmanifest" ||
    /\.(png|jpe?g|svg|ico|webmanifest|webp|gif)$/.test(pathname)
  ) {
    return NextResponse.next();
  }
  const sessionCookie = req.cookies.get(COOKIE_NAME)?.value;
  if (!sessionCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
