import { NextResponse, type NextRequest } from "next/server";
import { COOKIES } from "@/lib/api/config";
import { forwardedHeaders } from "@healthcare/web-session";
import { clearSessionCookies, refreshTokens, writeTokenCookies } from "@/lib/api/tokens";

/**
 * Session gate for every staff page.
 *
 * - No refresh token → sign in.
 * - Access token expired (its cookie is gone) → refresh once, then pass the new
 *   tokens both to this request (so the page renders signed in) and to the browser.
 *
 * Proxy is not the only check: every API call is authorized by the API itself,
 * and `api()` sends the user to sign in on a 401.
 */
/** Pages anyone may open, signed in or not. They must not call the API. */
const PUBLIC_PATHS = new Set(["/welcome"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isLogin = pathname === "/login" || pathname.startsWith("/login/");
  const refreshToken = request.cookies.get(COOKIES.refresh)?.value;
  const accessToken = request.cookies.get(COOKIES.access)?.value;

  // Public pages (the landing page) render for everyone and never touch the session.
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (isLogin) {
    // The API ended the session (a call returned 401): drop the stale cookies and show the form,
    // instead of bouncing back to "/" with them and looping.
    if (request.nextUrl.searchParams.get("reason") === "session") {
      const response = NextResponse.next();
      clearSessionCookies(response.cookies);
      return response;
    }
    // Already signed in: skip the form.
    if (refreshToken && accessToken) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  const toLogin = () => {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    const response = NextResponse.redirect(url);
    clearSessionCookies(response.cookies);
    return response;
  };

  if (!refreshToken) return toLogin();
  if (accessToken) return NextResponse.next();

  const refreshed = await refreshTokens(refreshToken, fetch, Date.now(), forwardedHeaders(request.headers));
  if (refreshed.status === "rejected") return toLogin();
  if (refreshed.status === "unavailable") return unavailable();
  const { tokens } = refreshed;

  // Forward the new tokens to this render (request cookies carry values only)…
  request.cookies.set(COOKIES.access, tokens.accessToken);
  request.cookies.set(COOKIES.refresh, tokens.refreshToken);
  const response = NextResponse.next({ request: { headers: request.headers } });
  // …and persist them in the browser.
  writeTokenCookies(response.cookies, tokens);
  return response;
}

/** The API is rate-limiting or down: keep the session cookies and ask the user to retry, rather than signing them out. */
function unavailable() {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>Temporarily unavailable</title>
<body style="font:14px system-ui;margin:3rem;max-width:32rem"><h1 style="font-size:18px">The patient record service is busy</h1>
<p>Your session is still active. This page will retry in a few seconds.</p><p><a href="">Retry now</a></p></body>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "10", "cache-control": "no-store" } },
  );
}

export const config = {
  // Everything except static assets and Next internals.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
