import type { ContactPoint, Location, Organization, Patient, Practitioner } from "fhir/r4";
import type { FacilitySource, FhirContext, PatientSource, PractitionerSource } from "./sources";
import { address, compact, identifier, identifierSystem, localSystem, ref, text } from "./support";
import { SYSTEMS } from "./terminology";

const MARITAL: Record<string, { code: string; display: string }> = {
  single: { code: "S", display: "Never Married" },
  married: { code: "M", display: "Married" },
  widowed: { code: "W", display: "Widowed" },
  annulled: { code: "A", display: "Annulled" },
};

export function toPatient(ctx: FhirContext, p: PatientSource): Patient {
  const given = [p.givenName, p.middleName].filter((n): n is string => Boolean(n));
  return compact<Patient>({
    resourceType: "Patient",
    id: p.id,
    meta: { lastUpdated: p.updatedAt },
    identifier: [
      identifier(localSystem(ctx, "patient-number"), p.patientNumber, {
        use: "usual",
        type: { coding: [{ system: SYSTEMS.v2IdentifierType, code: "MR", display: "Medical record number" }], text: "Patient number" },
      }),
      ...p.identifiers.map((i) =>
        compact({
          system: identifierSystem(ctx, i.type),
          value: i.value,
          type: text(i.type.replace(/_/g, " ")),
          period: i.validFrom || i.validUntil ? compact({ start: i.validFrom ?? undefined, end: i.validUntil ?? undefined }) : undefined,
          assigner: i.issuer ? { display: i.issuer } : undefined,
        }),
      ),
    ],
    active: p.status === "active" || p.status === "deceased",
    name: [
      compact({
        use: "official" as const,
        family: p.familyName,
        given,
        suffix: p.suffix ? [p.suffix] : undefined,
        text: `${p.familyName.toUpperCase()}, ${[...given, p.suffix].filter(Boolean).join(" ")}`,
      }),
    ],
    telecom: p.contacts.map((c) => telecom(c)),
    gender: p.sex === "male" || p.sex === "female" ? p.sex : p.sex === "intersex" ? "other" : "unknown",
    birthDate: p.birthDate,
    deceasedDateTime: p.deceasedAt ?? undefined,
    address: p.addresses.map((a) => address(a)),
    maritalStatus: p.civilStatus
      ? MARITAL[p.civilStatus]
        ? { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus", ...MARITAL[p.civilStatus] }], text: p.civilStatus }
        : text(p.civilStatus)
      : undefined,
    contact: p.emergencyContacts
      .filter((c) => c.name || c.contactNumber)
      .map((c) =>
        compact({
          relationship: [
            { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0131", code: "C", display: "Emergency Contact" }] },
            text(c.relationship.replace(/_/g, " ")),
          ],
          name: c.name ? { text: c.name } : undefined,
          telecom: c.contactNumber ? [{ system: "phone" as const, value: c.contactNumber }] : undefined,
        }),
      ),
    managingOrganization: ref("Organization", ctx.organization.id, ctx.organization.name),
    link: p.mergedIntoPatientId ? [{ other: ref("Patient", p.mergedIntoPatientId), type: "replaced-by" }] : undefined,
  });
}

function telecom(c: PatientSource["contacts"][number]): ContactPoint {
  if (c.system === "email")
    return compact({ system: "email" as const, value: c.value, use: c.use === "work" ? ("work" as const) : undefined, rank: c.isPrimary ? 1 : undefined });
  return compact({
    system: "phone" as const,
    value: c.value,
    use: c.system === "mobile" ? ("mobile" as const) : c.use === "work" ? ("work" as const) : ("home" as const),
    rank: c.isPrimary ? 1 : undefined,
  });
}

export function toOrganization(ctx: FhirContext): Organization {
  return {
    resourceType: "Organization",
    id: ctx.organization.id,
    identifier: [identifier(localSystem(ctx, "organization-code"), ctx.organization.code)],
    active: true,
    name: ctx.organization.name,
  };
}

/** A facility as a FHIR Location operated by the organization. */
export function toLocation(ctx: FhirContext, f: FacilitySource): Location {
  return compact<Location>({
    resourceType: "Location",
    id: f.id,
    identifier: [
      identifier(localSystem(ctx, "facility-code"), f.code),
      ...(f.licenseNumber ? [identifier(identifierSystem(ctx, "facility_license"), f.licenseNumber, { type: text("Facility license") })] : []),
    ],
    status: f.status === "active" ? "active" : "inactive",
    name: f.name,
    mode: "instance",
    type: [text(f.facilityType.replace(/_/g, " "))],
    telecom: [
      ...(f.contactNumber ? [{ system: "phone" as const, value: f.contactNumber, use: "work" as const }] : []),
      ...(f.email ? [{ system: "email" as const, value: f.email, use: "work" as const }] : []),
    ],
    address: f.cityMunicipality ? address({ ...f, line1: f.addressLine, use: "work" }) : undefined,
    managingOrganization: ref("Organization", ctx.organization.id, ctx.organization.name),
  });
}

export function toPractitioner(ctx: FhirContext, p: PractitionerSource): Practitioner {
  return compact<Practitioner>({
    resourceType: "Practitioner",
    id: p.id,
    identifier: p.licenseNumber ? [identifier(identifierSystem(ctx, "prc_license"), p.licenseNumber, { type: text("PRC license") })] : undefined,
    active: p.status === "active",
    name: [{ text: p.displayName }],
    qualification: [{ code: text([p.profession.replace(/_/g, " "), p.specialty].filter(Boolean).join(" — ")) }],
  });
}
