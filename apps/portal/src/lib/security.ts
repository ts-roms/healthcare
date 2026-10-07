/** Sign-in security in the patient's words: what the API's refusals mean, and what to do about them. */

export function securityMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "invalid_credentials":
      return "The password is not correct.";
    case "account_locked":
      return "Too many wrong tries. Try again in about 15 minutes.";
    case "invalid_verification_code":
      return "That code is not correct, or it has expired. Ask for a new code.";
    case "verification_too_soon":
      return "A code was just sent. Wait a minute before asking for another.";
    case "verification_rate_limited":
      return "Too many codes were sent in the last hour. Try again later.";
    case "email_already_verified":
      return "This email is already verified.";
    case "email_in_use":
      return "This email is already used for another MyHealth account.";
    case "email_unchanged":
      return "That is already your sign-in email.";
    case "email_not_verified":
      return "Verify your email address first.";
    case "mfa_code_required":
      return "Enter the code from your authenticator app.";
    case "invalid_mfa_code":
      return "That code is not correct. Use the newest code in your authenticator app, or a recovery code.";
    case "mfa_already_enabled":
      return "Two-step verification is already on.";
    case "mfa_setup_not_started":
      return "Start again from the beginning: ask for a new setup key.";
    case "mfa_enrollment_required":
      return "Your clinic requires two-step verification. Set it up here to continue.";
    case "passkeys_unavailable":
      return "Passkeys are not available on this MyHealth address.";
    case "passkey_limit_reached":
      return "You already have 5 passkeys. Remove one first.";
    case "passkey_challenge_invalid":
      return "Adding the passkey took too long. Start again.";
    case "passkey_not_verified":
      return "The passkey could not be checked. Try again.";
    case "passkey_already_added":
      return "This passkey is already added.";
    default:
      return fallback;
  }
}

/**
 * What the clinic's two-step verification requirement means for this account, in the patient's words; null when there is
 * nothing to say (not required, or already on). `requiredFrom` is the clinic's local date, shown as given.
 */
export function mfaPolicyNotice(policy: { required: boolean; requiredFrom: string | null; enrollmentRequired: boolean }, mfaEnabled: boolean): string | null {
  if (!policy.required || mfaEnabled) return null;
  if (policy.enrollmentRequired) return "Your clinic now requires two-step verification. Set it up to use MyHealth.";
  return policy.requiredFrom
    ? `From ${policy.requiredFrom}, your clinic requires two-step verification. Set it up now so nothing waits.`
    : "Your clinic requires two-step verification. Set it up now so nothing waits.";
}

/** Recovery codes stay in the browser's memory only until the patient says they saved them. */
export function recoveryCodesText(codes: readonly string[]): string {
  return codes.join("\n");
}

/** Warns when few recovery codes are left. */
export function recoveryCodesLow(remaining: number): boolean {
  return remaining <= 2;
}
