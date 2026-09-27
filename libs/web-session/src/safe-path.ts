/**
 * Only same-origin relative paths may be used as a post-sign-in redirect (no
 * open redirects), and never back to a sign-in page.
 */
export function safeNextPath(value: unknown, fallback = "/", authPaths: readonly string[] = ["/login"]): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (authPaths.some((p) => value === p || value.startsWith(`${p}/`) || value.startsWith(`${p}?`))) return fallback;
  return value;
}
