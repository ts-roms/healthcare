import type { DbExecutor } from "@healthcare/core";
import { eq } from "drizzle-orm";
import { DEFAULT_MINOR_AGE_YEARS, DEFAULT_REQUEST_VALID_DAYS } from "./procedure.rules";
import { consentSigningSetting } from "./procedure.schema";

/** The organization's choices for signing consent forms, with the reference defaults until it sets its own (0121). */
export interface ConsentSigningSettingView {
  /** Under this age (full years) a parent or guardian signs; null = no age rule. */
  minorAgeYears: number | null;
  /** Patients and their guardians may sign requested forms in MyHealth. */
  portalSigningEnabled: boolean;
  /** Days a signature request stays open. */
  requestValidDays: number;
  /** 0 while the organization has never saved its own. */
  version: number;
}

export async function loadSigningSetting(executor: DbExecutor, organizationId: string): Promise<ConsentSigningSettingView> {
  const [row] = await executor.select().from(consentSigningSetting).where(eq(consentSigningSetting.organizationId, organizationId));
  return row
    ? { minorAgeYears: row.minorAgeYears, portalSigningEnabled: row.portalSigningEnabled, requestValidDays: row.requestValidDays, version: row.version }
    : { minorAgeYears: DEFAULT_MINOR_AGE_YEARS, portalSigningEnabled: false, requestValidDays: DEFAULT_REQUEST_VALID_DAYS, version: 0 };
}
