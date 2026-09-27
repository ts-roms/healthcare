import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { APP_CONFIG, type AppConfig, UnauthenticatedError } from "@healthcare/core";

const ISSUER = "healthcare-platform";
const AUDIENCE = "healthcare-api";
const MFA_CHALLENGE_TTL_SECONDS = 300;
/** Realtime tickets are exchanged immediately for a socket connection. */
export const REALTIME_TICKET_TTL_SECONDS = 60;

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  org: string;
  typ: "access";
}

/**
 * Short-lived ticket for the realtime gateway, bound to a session and a
 * facility. It lets a browser open a socket without ever holding an access
 * token (the staff app keeps those server-side). It is not an access token.
 */
export interface RealtimeTicketClaims {
  sub: string;
  sid: string;
  org: string;
  fac: string;
  typ: "realtime";
}

export interface MfaChallengeClaims {
  sub: string;
  org: string;
  typ: "mfa_challenge";
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get accessTokenTtlSeconds(): number {
    return this.config.JWT_ACCESS_TTL_SECONDS;
  }

  signAccessToken(claims: Omit<AccessTokenClaims, "typ">): Promise<string> {
    return this.sign({ ...claims, typ: "access" }, this.config.JWT_ACCESS_TTL_SECONDS);
  }

  signMfaChallenge(claims: Omit<MfaChallengeClaims, "typ">): Promise<string> {
    return this.sign({ ...claims, typ: "mfa_challenge" }, MFA_CHALLENGE_TTL_SECONDS);
  }

  signRealtimeTicket(claims: Omit<RealtimeTicketClaims, "typ">): Promise<string> {
    return this.sign({ ...claims, typ: "realtime" }, REALTIME_TICKET_TTL_SECONDS);
  }

  verifyRealtimeTicket(token: string): Promise<RealtimeTicketClaims> {
    return this.verify<RealtimeTicketClaims>(token, "realtime");
  }

  verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    return this.verify<AccessTokenClaims>(token, "access");
  }

  verifyMfaChallenge(token: string): Promise<MfaChallengeClaims> {
    return this.verify<MfaChallengeClaims>(token, "mfa_challenge");
  }

  private sign(payload: object, expiresIn: number): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.JWT_ACCESS_SECRET,
      algorithm: "HS256",
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn,
    });
  }

  private async verify<T extends { typ: string }>(token: string, type: T["typ"]): Promise<T> {
    let claims: T;
    try {
      claims = await this.jwt.verifyAsync<T & object>(token, {
        secret: this.config.JWT_ACCESS_SECRET,
        algorithms: ["HS256"],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
    } catch {
      throw new UnauthenticatedError("Invalid or expired token", "invalid_token");
    }
    if (claims.typ !== type) throw new UnauthenticatedError("Invalid token type", "invalid_token");
    return claims;
  }
}
