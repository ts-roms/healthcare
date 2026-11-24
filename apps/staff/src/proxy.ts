import { NextResponse, type NextRequest } from "next/server";
import { COOKIES, REALTIME_URL } from "@/lib/api/config";
import { buildAppCsp, busyPage, forwardedHeaders, newNonce, parseOrigins } from "@healthcare/web-session";
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
const PUBLIC_PATHS = new Set(["/welcome", "/forgot-password", "/reset-password"]);

async function gate(request: NextRequest, next: () => NextResponse): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const isLogin = pathname === "/login" || pathname.startsWith("/login/");
  const refreshToken = request.cookies.get(COOKIES.refresh)?.value;
  const accessToken = request.cookies.get(COOKIES.access)?.value;

  // Public pages (the landing page) render for everyone and never touch the session.
  if (PUBLIC_PATHS.has(pathname)) return next();

  if (isLogin) {
    // The API ended the session (a call returned 401): drop the stale cookies and show the form,
    // instead of bouncing back to "/" with them and looping.
    if (request.nextUrl.searchParams.get("reason") === "session") {
      const response = next();
      clearSessionCookies(response.cookies);
      return response;
    }
    // Already signed in: skip the form.
    if (refreshToken && accessToken) return NextResponse.redirect(new URL("/", request.url));
    return next();
  }

  const toLogin = () => {
    // A signed-out visitor at the site root lands on the public landing page, which links to sign-in; any other page
    // goes to sign-in and comes back to where they were going.
    const url = new URL(pathname === "/" ? "/welcome" : "/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    const response = NextResponse.redirect(url);
    clearSessionCookies(response.cookies);
    return response;
  };

  if (!refreshToken) return toLogin();
  if (accessToken) return next();

  const refreshed = await refreshTokens(refreshToken, fetch, Date.now(), forwardedHeaders(request.headers));
  if (refreshed.status === "rejected") return toLogin();
  if (refreshed.status === "unavailable") return unavailable();
  const { tokens } = refreshed;

  // Forward the new tokens to this render (request cookies carry values only)…
  request.cookies.set(COOKIES.access, tokens.accessToken);
  request.cookies.set(COOKIES.refresh, tokens.refreshToken);
  const response = next();
  // …and persist them in the browser.
  writeTokenCookies(response.cookies, tokens);
  return response;
}

/**
 * Every page gets a Content Security Policy with a fresh nonce (zero-trust audit F2, `buildAppCsp` in
 * `@healthcare/web-session`): sent to the page as a request header, so Next.js puts the nonce on its own scripts, and
 * to the browser on the response. The root layout renders per request (`connection()`), as a nonce needs.
 */
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const policy = buildAppCsp(nonce, {
    development: process.env.NODE_ENV === "development",
    realtimeUrl: REALTIME_URL,
    connectOrigins: parseOrigins(process.env.CSP_CONNECT_ORIGINS),
  });
  // Built when called: after a refresh the request's cookies (and so its headers) carry the renewed tokens.
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", policy);
    return NextResponse.next({ request: { headers } });
  };
  const response = await gate(request, next);
  response.headers.set("content-security-policy", policy);
  return response;
}

/** The API is rate-limiting or down: keep the session cookies and ask the user to retry, rather than signing them out. */
function unavailable() {
  const page = busyPage({
    title: "Service busy · Healthcare Platform",
    brand: { name: "Healthcare Platform", icon: "activity" },
    heading: "The patient record service is busy",
    message: "Your session is still active, so you do not need to sign in again. This page will try again by itself in a few seconds.",
    retryLabel: "Try again now",
    note: "If this keeps happening, tell your administrator.",
  });
  return new NextResponse(page.body, page.init);
}

export const config = {
  // Everything except static assets and Next internals.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
