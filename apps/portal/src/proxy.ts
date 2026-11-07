import { NextResponse, type NextRequest } from "next/server";
import { buildAppCsp, forwardedHeaders, newNonce, parseOrigins } from "@healthcare/web-session";
import { COOKIES, REALTIME_URL } from "@/lib/api/config";
import { ACTING_COOKIE, isOwnAccountScreen } from "@/lib/proxy-access";
import { clearSessionCookies, refreshTokens, writeTokenCookies } from "@/lib/api/tokens";

/** Pages that work without a session. */
const PUBLIC_PATHS = ["/login", "/activate", "/forgot-password"];
/** Pages for everyone, signed in or not (the MyHealth guide; the reset and opt-out links, whose tokens must survive), passed through without touching the session. */
const OPEN_PATHS = ["/help", "/reset-password", "/outreach/opt-out"];

/**
 * Session gate for every portal page (same model as the staff app).
 *
 * - No refresh token → sign in.
 * - Access token expired (its cookie is gone) → refresh once, then pass the new
 *   tokens both to this request and to the browser.
 *
 * The API re-checks the session, the account and the patient's portal consent
 * on every call; `portalApi()` sends the patient to sign in on a 401.
 */
async function gate(request: NextRequest, next: () => NextResponse): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return next();
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const refreshToken = request.cookies.get(COOKIES.refresh)?.value;
  const accessToken = request.cookies.get(COOKIES.access)?.value;

  if (isPublic) {
    // The API ended the session (a call returned 401): drop the stale cookies and show the form,
    // instead of bouncing back to "/" with them and looping.
    if (request.nextUrl.searchParams.get("reason") === "session") {
      const response = next();
      clearSessionCookies(response.cookies);
      return response;
    }
    if (refreshToken && accessToken) return NextResponse.redirect(new URL("/", request.url));
    return next();
  }

  const toLogin = () => {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    const response = NextResponse.redirect(url);
    clearSessionCookies(response.cookies);
    return response;
  };

  if (!refreshToken) return toLogin();
  // While acting for someone else, the account holder's own settings are not theirs to change: back to the person switcher.
  if (request.cookies.get(ACTING_COOKIE)?.value && isOwnAccountScreen(pathname)) return NextResponse.redirect(new URL("/people?own=1", request.url));
  if (accessToken) return next();

  const refreshed = await refreshTokens(refreshToken, fetch, Date.now(), forwardedHeaders(request.headers));
  if (refreshed.status === "rejected") return toLogin();
  if (refreshed.status === "unavailable") return unavailable();
  const { tokens } = refreshed;

  request.cookies.set(COOKIES.access, tokens.accessToken);
  request.cookies.set(COOKIES.refresh, tokens.refreshToken);
  const response = next();
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

/** The API is busy or down: keep the session and retry, rather than signing the patient out. */
function unavailable() {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><title>MyHealth is busy</title>
<body style="font:16px system-ui;margin:2rem;max-width:30rem"><h1 style="font-size:20px">MyHealth is busy right now</h1>
<p>You are still signed in. This page will try again in a few seconds.</p><p><a href="">Try again now</a></p></body>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "10", "cache-control": "no-store" } },
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
