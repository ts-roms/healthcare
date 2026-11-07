/**
 * The kiosk's Content Security Policy (docs/security/kiosk-audit-phase-6.md, KA-09). Scripts run only when they carry this
 * request's nonce (Next.js adds it to its own scripts when the policy reaches the page as a request header), so an injected
 * script would not run even if markup got through. Styles allow inline attributes (React style props cannot carry a nonce);
 * nothing else is loaded from outside this origin, and the kiosk is never framed.
 */
export function buildCsp(nonce: string, development = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** A fresh, unpredictable nonce for one request. */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}
