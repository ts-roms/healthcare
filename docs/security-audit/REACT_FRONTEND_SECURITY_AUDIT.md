# React / Frontend Security Audit - Stage A, read-only

Scope: apps/staff, apps/portal, apps/mobile, libs/ui, libs/web-session. Method: grep and read; nothing executed or built.

## 1. Token storage
- Web: tokens only in httpOnly cookies set by the Next server (libs/web-session/src/session.ts:37-45; cookie names in apps/staff/src/lib/api/config.ts COOKIES). Refresh cookie `sameSite=strict`, access `lax`; `secure` only when NODE_ENV=production (config.ts SECURE_COOKIES). No token in localStorage/sessionStorage per grep of staff and portal source. Verified secure.
- localStorage holds non-secret UI state only: sound settings (apps/staff/src/app/(display)/display/queue/display-board.tsx:344,401), scan mode (patients/scan/scan-qr.tsx:25,36), idle timestamp (components/idle-sign-out.tsx:30), sidebar (libs/ui/src/layouts/staff-layout.tsx:44,53), tour (lib/tour.ts:43,51), offline pending count (lib/offline/store.ts:55,62,69). Verified secure.
- Staff offline outbox (ADR-0013): registration and vitals (PHI) sealed with AES-GCM and stored in IndexedDB (lib/offline/store.ts:15,40-50); the key sits in sessionStorage of the same origin (lib/offline/crypto.ts:21-32). Any XSS can read both, so encryption only helps against disk-only access. No call of `clearActions` (store.ts:59) on the sign-out or idle sign-out path was found: FE-003.
- Mobile: refresh token in expo-secure-store with WHEN_UNLOCKED_THIS_DEVICE_ONLY (apps/mobile/src/lib/secure-token-store.ts:10-15). Verified secure.

## 2. dangerouslySetInnerHTML and Markdown
Four sinks, each rendering an SVG QR string generated on the Next server with `qrcode`: apps/staff/src/app/(staff)/account/account-forms.tsx:194, apps/portal/src/app/(portal)/qr/page.tsx:31, apps/portal/src/app/(portal)/security/mfa-section.tsx:198, libs/ui/src/healthcare/app-download.tsx:41. Sources are generated, not user text; the origin of `code.svg` in app-download.tsx was not traced (FE-006). The Markdown primitive (libs/ui/src/primitives/markdown.tsx) uses react-markdown with remark-gfm and no raw-HTML plugin, so raw HTML is not rendered; its input is repository documentation. Verified secure.

## 3. Security headers / CSP
apps/staff/next.config.ts and apps/portal/next.config.ts define no `headers()`; the proxy.ts files set none; the only helmet use is the API (apps/api/src/app/configure-app.ts:18). So the web apps ship no CSP, frame-ancestors/X-Frame-Options, HSTS, nosniff, Referrer-Policy or Permissions-Policy unless an edge proxy adds them (none in repo; Not verified): FE-001, FE-002.

## 4. Third-party scripts, source maps, public env
No external script tags found in staff/portal source (layouts not exhaustively searched). `productionBrowserSourceMaps` is not set (default off). No `NEXT_PUBLIC_` in staff/portal source. Mobile `EXPO_PUBLIC_API_BASE_URL` / `ORGANIZATION_CODE` are inlined, non-secret (apps/mobile/src/lib/config.ts:5-6). Verified secure.

## 5. Service worker
Staff apps/staff/public/sw.js: origin-root scope; caches the `/offline` navigation response and `/_next/static/*` only (sw.js:40-65). The authenticated /offline HTML is cached (sw.js:42-47) and is not cleared at sign-out: FE-003. Push `notificationclick` accepts any url starting with "/" (sw.js:80), including protocol-relative `//host`, then `client.navigate(url)` (sw.js:94-98): FE-004 (payload is server-generated, low impact). Portal service worker not read (Not verified).

## 6. Permission-based rendering vs server enforcement
Navigation derives from API permissions, and every API call is authorized by the API (apps/staff/src/proxy.ts:14-15 comment). Route handlers for files and exports pass only allowlisted paths and validated filters to the API with the user's session (apps/staff/src/app/files/[...path]/route.ts, lib/files.ts:9-30, management/export/route.ts). Verified secure for the handlers read.

## 7. Errors, logging, redirects
`console.*` in staff, portal, mobile, ui and web-session source: none found by grep (tests excluded). Route handler errors are generic. Redirect helper `safeNextPath` is safe (libs/web-session/src/safe-path.ts:5-8).

## 8. Mobile
URL scheme derived per app (apps/mobile/app.config.ts:25-47); no deep links in use. No explicit `allowBackup` or cleartext setting found in app.config.ts/app.json (defaults not verified): FE-005. A native `apps/mobile/android/` tree with build intermediates is present in the working directory; confirm it is git-ignored (Not verified).

## Findings
| ID | Sev | Location | Evidence | Exploitability | Impact | Recommended fix | Status |
|---|---|---|---|---|---|---|---|
| FE-001 | MEDIUM | apps/staff/next.config.ts; apps/portal/next.config.ts; both proxy.ts | No `headers()`/CSP anywhere in web apps | Any future XSS is unmitigated; no defence in depth | Session and PHI exposure on XSS | Add strict nonce CSP, Referrer-Policy, Permissions-Policy | Open |
| FE-002 | MEDIUM | same files | No frame-ancestors/X-Frame-Options, HSTS, nosniff | Clickjacking of staff/portal pages (payments, consent, sign) | UI redress | Set `frame-ancestors 'none'`, HSTS, nosniff in app or edge | Open |
| FE-003 | LOW | apps/staff/public/sw.js:42-47; apps/staff/src/lib/offline/store.ts:59 | Authenticated /offline HTML cached; outbox not cleared on sign-out | Next user of a shared workstation | PHI remnants in cache/IndexedDB | Clear cache and outbox on sign-out and idle sign-out; warn if outbox non-empty | Open |
| FE-004 | LOW | apps/staff/public/sw.js:80,94-98 | `startsWith("/")` allows `//evil.com` | Needs attacker-controlled push payload | Open redirect via notification click | Reject `//` and `/\` | Open |
| FE-005 | INFO | apps/mobile/app.config.ts, app.json | No `android.allowBackup=false`; HTTPS-only base not enforced in config | Device backup extraction | Low (token in SecureStore) | Set allowBackup false; validate API base is https | Open (Not verified) |
| FE-006 | INFO | libs/ui/src/healthcare/app-download.tsx:41 | `code.svg` origin not traced | n/a | XSS only if untrusted | Confirm server-generated or sanitise | Open (Not verified) |
