/**
 * The Content Security Policy of the staff app and MyHealth (zero-trust audit F2; the kiosk has its own, stricter one).
 * Scripts run only when they carry this request's nonce: Next.js adds it to its own scripts when the policy reaches the
 * page as a request header, so an injected script does not run even if markup got through. Styles allow inline
 * attributes (React style props cannot carry a nonce). Connections go only to this origin, the live-update socket and
 * the origins the deployment lists (video, `CSP_CONNECT_ORIGINS`); signed document links (object storage, https) may be
 * shown in an image or a frame, never run as script.
 */
export interface AppCspOptions {
  /** `next dev` needs eval for fast refresh. */
  development?: boolean;
  /** The live-update socket's URL (`REALTIME_URL`): its origin is allowed over https and wss. */
  realtimeUrl?: string;
  /** Further origins the browser may connect to, e.g. the video service (`wss://video.example.ph`). */
  connectOrigins?: readonly string[];
}

/** The origin of `value` and its WebSocket twin (https ↔ wss, http ↔ ws); nothing for a value that is not a URL. */
function originsOf(value: string): string[] {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return [];
  }
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  const host = url.host;
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return [];
  return secure ? [`https://${host}`, `wss://${host}`] : [`http://${host}`, `ws://${host}`];
}

/** Parses a comma- or space-separated list of origins (`CSP_CONNECT_ORIGINS`). */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function buildAppCsp(nonce: string, options: AppCspOptions = {}): string {
  const connect = new Set<string>(["'self'"]);
  for (const origin of [...(options.realtimeUrl ? [options.realtimeUrl] : []), ...(options.connectOrigins ?? [])]) {
    for (const o of originsOf(origin)) connect.add(o);
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    `connect-src ${[...connect].join(" ")}`,
    "media-src 'self' blob:",
    "frame-src 'self' https: blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/** A fresh, unpredictable nonce for one request. */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}
