/**
 * Acting for another person in MyHealth (guardian access), shared by the web portal and the mobile app. The chosen
 * person's patient id is sent to the API as `X-Acting-For` — except on the routes about the account holder's own account
 * (sign-in security, notification settings, consents, devices, this feature itself), which the API refuses while acting.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OWN_ACCOUNT_API_PATHS = [
  "/portal/auth",
  "/portal/consents",
  "/portal/communication-preferences",
  "/portal/push",
  "/portal/proxy",
  "/portal/email",
  "/portal/mfa",
];

export function isOwnAccountApiPath(path: string): boolean {
  const clean = path.split("?")[0] ?? path;
  return OWN_ACCOUNT_API_PATHS.some((p) => clean === p || clean.startsWith(`${p}/`));
}

/** The header to send for an API path, or none. A value that is not a patient id is ignored. */
export function actingForHeader(path: string, patientId: string | null | undefined): Record<string, string> {
  if (!patientId || !UUID.test(patientId) || isOwnAccountApiPath(path)) return {};
  return { "x-acting-for": patientId };
}

export const RELATIONSHIP_LABEL: Record<string, string> = {
  parent: "Parent",
  legal_guardian: "Legal guardian",
  caregiver: "Caregiver",
  spouse_or_partner: "Spouse or partner",
  adult_child: "Adult child",
  other: "Other",
};
