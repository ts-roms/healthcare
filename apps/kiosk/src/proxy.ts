import { NextResponse, type NextRequest } from "next/server";
import { forwardedHeaders } from "@healthcare/web-session";
import { COOKIES } from "@/lib/config";
import { clearSessionCookies, refreshTokens, writeTokenCookies } from "@/lib/tokens";

/**
 * Session gate for the kiosk. The device signs in once at `/setup`; this renews its access token from the refresh token
 * so a screen can run for days. Every API call is still authorized by the API itself, and `kioskApi()` sends the screen
 * back to set-up on a 401. Every response is marked `no-store`, so nothing a patient saw is cached by the browser.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const refreshToken = request.cookies.get(COOKIES.refresh)?.value;
  const accessToken = request.cookies.get(COOKIES.access)?.value;

  if (pathname === "/setup" || pathname.startsWith("/setup/")) {
    // The API ended the session: drop the stale cookies and show the form, instead of looping.
    if (request.nextUrl.searchParams.get("reason") === "session") {
      const response = noStore(NextResponse.next());
      clearSessionCookies(response.cookies);
      return response;
    }
    if (refreshToken && accessToken) return noStore(NextResponse.redirect(new URL("/", request.url)));
    return noStore(NextResponse.next());
  }

  const toSetup = () => {
    const response = NextResponse.redirect(new URL("/setup", request.url));
    clearSessionCookies(response.cookies);
    return noStore(response);
  };

  if (!refreshToken) return toSetup();
  if (accessToken) return noStore(NextResponse.next());

  const refreshed = await refreshTokens(refreshToken, fetch, Date.now(), forwardedHeaders(request.headers));
  if (refreshed.status === "rejected") return toSetup();
  if (refreshed.status === "unavailable") return unavailable();
  const { tokens } = refreshed;

  // Pass the new tokens to this render and persist them in the browser.
  request.cookies.set(COOKIES.access, tokens.accessToken);
  request.cookies.set(COOKIES.refresh, tokens.refreshToken);
  const response = NextResponse.next({ request: { headers: request.headers } });
  writeTokenCookies(response.cookies, tokens);
  return noStore(response);
}

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("cache-control", "no-store");
  return response;
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
