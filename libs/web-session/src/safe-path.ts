/**
 * Only same-origin relative paths may be used as a post-sign-in redirect (no
 * open redirects), and never back to a sign-in page.
 *
 * Browsers drop tab, CR and LF while parsing a URL and treat a backslash like a
 * slash, so "/\t/evil.example" or "/\\evil.example" would become
 * "//evil.example" — another site. Any control character or backslash is
 * refused, and the result must still resolve to this origin.
 */
const BASE = "http://same-origin.invalid";

export function safeNextPath(value: unknown, fallback = "/", authPaths: readonly string[] = ["/login"]): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  let resolved: URL;
  try {
    resolved = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (resolved.origin !== BASE) return fallback;
  if (authPaths.some((p) => value === p || value.startsWith(`${p}/`) || value.startsWith(`${p}?`))) return fallback;
  return value;
}
