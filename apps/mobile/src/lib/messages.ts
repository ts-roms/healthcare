/** What the API's refusals mean to the person signing in, in plain words. */
export function signInMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "invalid_credentials":
      return "The email or password is not correct.";
    case "account_locked":
      return "Too many wrong tries. Try again in about 15 minutes.";
    case "invalid_mfa_code":
    case "mfa_code_required":
      return "That code is not correct. Use the newest code in your authenticator app, or a recovery code.";
    case "invalid_mfa_challenge":
    case "mfa_challenge_expired":
      return "The sign-in took too long. Enter your password again.";
    case "forbidden":
      return "MyHealth is not available for this account. Please contact the clinic.";
    default:
      return fallback;
  }
}
