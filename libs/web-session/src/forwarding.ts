/**
 * The API rate-limits credential endpoints per client IP and records the
 * client IP and user agent in the audit trail. Behind this backend-for-frontend
 * every call would otherwise come from the staff server's own address, so the
 * browser's identity is forwarded. The API must run with TRUST_PROXY=true and
 * be reachable only through the staff app (or a trusted proxy), otherwise a
 * client could spoof X-Forwarded-For.
 */
export interface HeaderSource {
  get(name: string): string | null;
}

/**
 * The client address as seen by the nearest proxy: the right-most
 * X-Forwarded-For entry (Next sets it from the socket when there is no proxy).
 * Assumes at most one trusted proxy in front of the staff app.
 */
export function clientIp(headers: HeaderSource): string | undefined {
  const chain = headers.get("x-forwarded-for");
  const last = chain?.split(",").pop()?.trim();
  return last || undefined;
}

export function forwardedHeaders(headers: HeaderSource): Record<string, string> {
  const out: Record<string, string> = {};
  const ip = clientIp(headers);
  if (ip) out["x-forwarded-for"] = ip;
  const ua = headers.get("user-agent");
  if (ua) out["user-agent"] = ua;
  return out;
}
