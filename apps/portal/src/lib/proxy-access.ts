import { actingForHeader as header } from "@healthcare/domain/proxy-access";

/**
 * Acting for another person in MyHealth (guardian access). The chosen person's patient id is kept in an httpOnly cookie
 * and sent to the API as `X-Acting-For` — except on the routes about the account holder's own account (sign-in security,
 * notification settings, consents, devices, this feature itself), which the API refuses while acting. The rules for which
 * paths those are live in `@healthcare/domain/proxy-access`, shared with the mobile app.
 */
export const ACTING_COOKIE = "hp_for";

export { isOwnAccountApiPath, RELATIONSHIP_LABEL } from "@healthcare/domain/proxy-access";

/** Screens about the account holder's own account: not available while acting for someone. */
export const OWN_ACCOUNT_SCREENS = ["/profile", "/security", "/notification-settings", "/privacy"];

export function isOwnAccountScreen(pathname: string): boolean {
  return OWN_ACCOUNT_SCREENS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The header to send for an API path, or none. A cookie that is not a patient id is ignored. */
export function actingForHeader(path: string, cookieValue: string | undefined): Record<string, string> {
  return header(path, cookieValue);
}

/** What the API's refusal of an acting request means to the person using MyHealth. */
export function proxyMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "proxy_not_allowed":
      return "You can no longer act for this person. Their access may have ended or been changed at the clinic.";
    case "proxy_view_only":
      return "You can look at this record but not make changes. Ask the clinic if you need more access.";
    default:
      return fallback;
  }
}
