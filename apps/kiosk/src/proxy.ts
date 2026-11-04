import { NextResponse, type NextRequest } from "next/server";
import { forwardedHeaders } from "@healthcare/web-session";
import { COOKIES } from "@/lib/config";
import { buildCsp, newNonce } from "@/lib/csp";
import { clearSessionCookies, refreshTokens, writeTokenCookies } from "@/lib/tokens";

/**
 * Session gate for the kiosk. The device signs in once at `/setup`; this renews its access token from the refresh token
 * so a screen can run for days. Every API call is still authorized by the API itself, and `kioskApi()` sends the screen
 * back to set-up on a 401. Every response is marked `no-store`, so nothing a patient saw is cached by the browser.
 */
export async function proxy(request: NextRequest) {
  // A fresh nonce for this request: the policy goes to the page as a request header (so Next.js puts the nonce on its own scripts)
  // and to the browser as the response header.
  const nonce = newNonce();
  const policy = buildCsp(nonce, process.env.NODE_ENV === "development");
  const pageHeaders = new Headers(request.headers);
  pageHeaders.set("x-nonce", nonce);
  pageHeaders.set("content-security-policy", policy);
  const secure = <T extends NextResponse>(response: T): T => {
    response.headers.set("cache-control", "no-store");
    response.headers.set("content-security-policy", policy);
    return response;
  };
  const { pathname } = request.nextUrl;
  const refreshToken = request.cookies.get(COOKIES.refresh)?.value;
  const accessToken = request.cookies.get(COOKIES.access)?.value;

  if (pathname === "/setup" || pathname.startsWith("/setup/")) {
    // The API ended the session: drop the stale cookies and show the form, instead of looping.
    if (request.nextUrl.searchParams.get("reason") === "session") {
      const response = secure(NextResponse.next({ request: { headers: pageHeaders } }));
      clearSessionCookies(response.cookies);
      return response;
    }
    if (refreshToken && accessToken) return secure(NextResponse.redirect(new URL("/", request.url)));
    return secure(NextResponse.next({ request: { headers: pageHeaders } }));
  }

  const toSetup = () => {
    const response = NextResponse.redirect(new URL("/setup", request.url));
    clearSessionCookies(response.cookies);
    return secure(response);
  };

  if (!refreshToken) return toSetup();
  if (accessToken) return secure(NextResponse.next({ request: { headers: pageHeaders } }));

  const refreshed = await refreshTokens(refreshToken, fetch, Date.now(), forwardedHeaders(request.headers));
  if (refreshed.status === "rejected") return toSetup();
  if (refreshed.status === "unavailable") return unavailable();
  const { tokens } = refreshed;

  // Pass the new tokens to this render and persist them in the browser.
  request.cookies.set(COOKIES.access, tokens.accessToken);
  request.cookies.set(COOKIES.refresh, tokens.refreshToken);
  // The headers are copied again so that they carry the renewed cookies (setting them above changed the request's own headers).
  const renewedHeaders = new Headers(request.headers);
  renewedHeaders.set("x-nonce", nonce);
  renewedHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: renewedHeaders } });
  writeTokenCookies(response.cookies, tokens);
  return secure(response);
}

/** The API is busy or down: keep the device signed in and retry shortly, rather than asking for set-up again. */
function unavailable() {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>Please wait</title>
<body style="font:24px system-ui;margin:4rem;max-width:40rem"><h1>This kiosk is reconnecting</h1><p>Please wait a moment, or see the front desk.</p></body>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "10", "cache-control": "no-store" } },
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
