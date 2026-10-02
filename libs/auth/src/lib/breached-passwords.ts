import { createHash } from "node:crypto";
import { DynamicModule, Global, Logger, Module, type Provider } from "@nestjs/common";
import { APP_CONFIG, type AppConfig, BusinessRuleError, passwordBreachCheckEnabled } from "@healthcare/core";

/**
 * Breached-password screening (docs/security/access-control.md): every new password — chosen by staff or patients, or
 * set by an administrator — is looked up in the Pwned Passwords range API before it is saved. Only the first five
 * characters of the password's SHA-1 hash leave the server (k-anonymity); the rest is matched here. A password found
 * there is refused, and so is one that cannot be checked (the service unreachable, slow or answering oddly).
 * Passwords are not re-checked at sign-in.
 */
export interface BreachedPasswordChecker {
  /** True when the password appears in the breach corpus; throws {@link PasswordCheckUnavailable} when it cannot tell. */
  isBreached(password: string): Promise<boolean>;
}

export const BREACHED_PASSWORD_CHECKER = Symbol("BREACHED_PASSWORD_CHECKER");

export class PasswordCheckUnavailable extends Error {}

export type PasswordScreening = "accepted" | "password_breached" | "password_check_unavailable";

const PWNED_PASSWORDS_URL = "https://api.pwnedpasswords.com/range/";
const REQUEST_TIMEOUT_MS = 5_000;
const RANGE_LINE = /^([0-9A-F]{35}):(\d+)$/;

export class PwnedPasswordsRangeChecker implements BreachedPasswordChecker {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
  ) {}

  async isBreached(password: string): Promise<boolean> {
    const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    let body: string;
    try {
      // Padding makes every answer a similar size, so the response length does not hint at the prefix.
      const response = await this.fetchFn(`${PWNED_PASSWORDS_URL}${prefix}`, {
        headers: { "Add-Padding": "true", "User-Agent": "healthcare-platform" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new PasswordCheckUnavailable(`Pwned Passwords answered HTTP ${response.status}`);
      body = await response.text();
    } catch (error) {
      if (error instanceof PasswordCheckUnavailable) throw error;
      throw new PasswordCheckUnavailable(`Pwned Passwords could not be reached: ${(error as Error).message}`);
    }
    let lines = 0;
    for (const raw of body.split("\n")) {
      const line = raw.trim().toUpperCase();
      if (!line) continue;
      const match = RANGE_LINE.exec(line);
      if (!match) throw new PasswordCheckUnavailable("Pwned Passwords returned an unreadable answer");
      lines += 1;
      // Padding entries carry a count of 0 and are not breached passwords.
      if (match[1] === suffix && Number(match[2]) > 0) return true;
    }
    if (lines === 0) throw new PasswordCheckUnavailable("Pwned Passwords returned an empty answer");
    return false;
  }
}

/** Used when screening is turned off (`PASSWORD_BREACH_CHECK=false`, the default outside production). */
export const NO_BREACHED_PASSWORD_CHECK: BreachedPasswordChecker = { isBreached: async () => false };

/** Screens a new password; never throws, so callers can record a refusal before rejecting the request. */
export async function screenPassword(checker: BreachedPasswordChecker, password: string, logger?: Logger): Promise<PasswordScreening> {
  try {
    return (await checker.isBreached(password)) ? "password_breached" : "accepted";
  } catch (error) {
    logger?.warn(`Breached-password check unavailable: ${(error as Error).message}`);
    return "password_check_unavailable";
  }
}

/** The error a refused password answers with (422; the screens show the message). */
export function passwordRefusal(reason: Exclude<PasswordScreening, "accepted">): BusinessRuleError {
  return reason === "password_breached"
    ? new BusinessRuleError("This password has appeared in a data breach elsewhere. Choose a different password.", "password_breached")
    : new BusinessRuleError("We couldn't check this password right now. Try again in a few minutes.", "password_check_unavailable");
}

/** Screens a new password and throws its refusal, for flows that record no failed attempts. */
export async function assertPasswordAccepted(checker: BreachedPasswordChecker, password: string, logger?: Logger): Promise<void> {
  const outcome = await screenPassword(checker, password, logger);
  if (outcome !== "accepted") throw passwordRefusal(outcome);
}

/**
 * Provides {@link BREACHED_PASSWORD_CHECKER} application-wide (staff accounts here, patient accounts in
 * `@healthcare/patient`). Import once, in the app root module; tests pass their own provider.
 */
@Global()
@Module({})
export class PasswordScreeningModule {
  static forRoot(checker?: Provider): DynamicModule {
    return {
      module: PasswordScreeningModule,
      providers: [
        checker ?? {
          provide: BREACHED_PASSWORD_CHECKER,
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig): BreachedPasswordChecker => {
            if (passwordBreachCheckEnabled(config)) return new PwnedPasswordsRangeChecker();
            if (config.NODE_ENV === "production") {
              new Logger(PasswordScreeningModule.name).warn("PASSWORD_BREACH_CHECK=false: new passwords are not screened against breached passwords");
            }
            return NO_BREACHED_PASSWORD_CHECK;
          },
        },
      ],
      exports: [BREACHED_PASSWORD_CHECKER],
    };
  }
}
