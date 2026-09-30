import { NextResponse, type NextRequest } from "next/server";
import { forwardedHeaders } from "@healthcare/web-session";
import { COOKIES } from "@/lib/api/config";
import { ACTING_COOKIE, isOwnAccountScreen } from "@/lib/proxy-access";
import { clearSessionCookies, refreshTokens, writeTokenCookies } from "@/lib/api/tokens";

/** Pages that work without a session. */
const PUBLIC_PATHS = ["/login", "/activate", "/forgot-password"];
/** Pages for everyone, signed in or not (the MyHealth guide; the reset link, whose token must survive), passed through without touching the session. */
const OPEN_PATHS = ["/help", "/reset-password"];

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
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const refreshToken = request.cookies.get(COOKIES.refresh)?.value;
  const accessToken = request.cookies.get(COOKIES.access)?.value;

  if (isPublic) {
    // The API ended the session (a call returned 401): drop the stale cookies and show the form,
    // instead of bouncing back to "/" with them and looping.
    if (request.nextUrl.searchParams.get("reason") === "session") {
      const response = NextResponse.next();
      clearSessionCookies(response.cookies);
      return response;
    }
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
  // While acting for someone else, the account holder's own settings are not theirs to change: back to the person switcher.
  if (request.cookies.get(ACTING_COOKIE)?.value && isOwnAccountScreen(pathname)) return NextResponse.redirect(new URL("/people?own=1", request.url));
  if (accessToken) return NextResponse.next();

  const refreshed = await refreshTokens(refreshToken, fetch, Date.now(), forwardedHeaders(request.headers));
  if (refreshed.status === "rejected") return toLogin();
  if (refreshed.status === "unavailable") return unavailable();
  const { tokens } = refreshed;

  request.cookies.set(COOKIES.access, tokens.accessToken);
  request.cookies.set(COOKIES.refresh, tokens.refreshToken);
  const response = NextResponse.next({ request: { headers: request.headers } });
  writeTokenCookies(response.cookies, tokens);
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
