import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq, sql } from "drizzle-orm";
import { patient, patientContactPoint } from "../patient.schema";
import { givenNameKey, maskedName, selfServiceKey } from "./identity.rules";

export interface VerifiedPatient {
  patientId: string;
  /** Initials only: "J*** D*** C***". */
  maskedName: string;
  birthYear: number;
}

/**
 * Identification for self-service (a patient kiosk, docs/domains/kiosk.md). It answers one question — "is this person
 * a known, active patient?" — and only when three things agree: a patient number or mobile number, the exact date of
 * birth, and the given name. Anything short of one clear match is "no match" (the caller must not say which part was
 * wrong). It returns the patient's id and a masked name, never a record, and is read-only; the caller audits.
 *
 * A retired (merged) record resolves to the surviving record. Inactive and deceased records never match.
 */
@Injectable()
export class PatientIdentityService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async verify(organizationId: string, input: { key: string; birthDate: string; givenName: string }): Promise<VerifiedPatient | null> {
    const key = selfServiceKey(input.key);
    const given = givenNameKey(input.givenName);
    if (!key || !given) return null;

    const matches = await this.db
      .select({ id: patient.id, status: patient.status, mergedInto: patient.mergedIntoPatientId })
      .from(patient)
      .where(
        and(
          eq(patient.organizationId, organizationId),
          eq(patient.birthDate, input.birthDate),
          eq(patient.givenNameNormalized, given),
          key.kind === "patient_number"
            ? eq(patient.patientNumber, key.value)
            : sql`EXISTS (SELECT 1 FROM ${patientContactPoint} c
                WHERE c.patient_id = ${patient.id} AND c.system = 'mobile' AND c.status = 'active' AND c.value_normalized = ${key.value})`,
        ),
      )
      .limit(3);
    // Several people on one family phone with the same name and birth date: let the desk sort it out.
    if (matches.length !== 1) return null;
    const [found] = matches;
    let target = found!.id;
    if (found!.status === "merged" && found!.mergedInto) target = found!.mergedInto;
    else if (found!.status !== "active") return null;

    const [row] = await this.db
      .select({ id: patient.id, status: patient.status, givenName: patient.givenName, familyName: patient.familyName, birthDate: patient.birthDate })
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.id, target)));
    if (!row || row.status !== "active") return null;
    return { patientId: row.id, maskedName: maskedName(row.givenName, row.familyName), birthYear: Number(row.birthDate.slice(0, 4)) };
  }
}
