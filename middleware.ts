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
    pathname.startsWith("/api/evening") || // own key-gate; evening-review cron, no session cookie
    pathname.startsWith("/api/email") || // own key-gate; email-sync cron, no session cookie
    pathname.startsWith("/api/backup") || // own key-gate; nightly DB-backup cron, no session cookie
    pathname.startsWith("/api/automations") || // own key-gate; daily automations cron, no session cookie
    pathname.startsWith("/api/contacts/import") || // own auth (cookie OR key) — lets an iOS Shortcut post
    pathname.startsWith("/api/location") || // own key-gate; iOS Arrive automation, no session cookie
    pathname.startsWith("/api/stripe") || // signature-verified; Stripe payment webhook, no session cookie
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
