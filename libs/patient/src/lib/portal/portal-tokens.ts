import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { APP_CONFIG, type AppConfig, UnauthenticatedError } from "@healthcare/core";

const ISSUER = "healthcare-platform";
/**
 * A different audience from staff tokens ("healthcare-api"): a patient token
 * can never authenticate a staff route, and a staff token never a portal route.
 */
const AUDIENCE = "healthcare-portal";

export interface PatientAccessClaims {
  sub: string; // portal account id
  sid: string; // portal session id
  org: string;
  pat: string; // patient id
  typ: "patient_access";
}

@Injectable()
export class PortalTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get accessTokenTtlSeconds(): number {
    return this.config.JWT_ACCESS_TTL_SECONDS;
  }

  sign(claims: Omit<PatientAccessClaims, "typ">): Promise<string> {
    return this.jwt.signAsync(
      { ...claims, typ: "patient_access" },
      { secret: this.config.JWT_ACCESS_SECRET, algorithm: "HS256", issuer: ISSUER, audience: AUDIENCE, expiresIn: this.config.JWT_ACCESS_TTL_SECONDS },
    );
  }

  async verify(token: string): Promise<PatientAccessClaims> {
    let claims: PatientAccessClaims;
    try {
      claims = await this.jwt.verifyAsync<PatientAccessClaims>(token, {
        secret: this.config.JWT_ACCESS_SECRET,
        algorithms: ["HS256"],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
    } catch {
      throw new UnauthenticatedError("Invalid or expired token", "invalid_token");
    }
    if (claims.typ !== "patient_access") throw new UnauthenticatedError("Invalid token type", "invalid_token");
    return claims;
  }
}
