import { payloadDigest } from "../exchange/integration-exchanges.service";

/**
 * The platform's own, format-neutral view of a PhilHealth claim: what it can
 * assemble from its records for one issued invoice with PhilHealth coverage.
 * It is NOT the eClaims message format — an adapter maps it once the official
 * specification is obtained (docs/interoperability/philhealth-eclaims.md).
 * Money is integer centavos (PHP).
 */
export interface PhilHealthClaimPackage {
  /** Version of this internal model (not of any PhilHealth specification). */
  model: "platform-claim-1";
  invoice: { id: string; invoiceNumber: string; issuedAt: string; facilityId: string };
  facility: { accreditationNumber: string | null };
  patient: {
    id: string;
    patientNumber: string;
    familyName: string;
    givenName: string;
    middleName: string | null;
    suffix: string | null;
    sex: string;
    birthDate: string;
    philhealthPin: string | null;
  };
  coverage: { invoicePayerId: string; amountClaimed: number; reference: string | null };
  servicePeriod: { from: string; to: string };
  diagnoses: Array<{ codeSystem: string; code: string; display: string; primary: boolean }>;
  services: Array<{
    description: string;
    category: string;
    serviceDate: string;
    quantity: number;
    grossAmount: number;
    discountAmount: number;
    netAmount: number;
  }>;
  totals: { gross: number; discount: number; net: number };
}

/** What the API gathers from billing, the patient record and the clinic for one invoice. */
export interface ClaimSources {
  invoice: {
    id: string;
    invoiceNumber: string | null;
    status: "draft" | "issued" | "void";
    issuedAt: string | null;
    facilityId: string;
    patientId: string;
    grossTotal: number;
    discountTotal: number;
    netTotal: number;
    items: Array<{
      description: string;
      category: string;
      serviceDate: string;
      quantity: number;
      grossAmount: number;
      discountAmount: number;
      netAmount: number;
      sourceType: string;
      sourceId: string | null;
    }>;
    payers: Array<{ id: string; payerType: string; payerName: string; amount: number; reference: string | null; status: string }>;
  };
  patient: ClaimSourcePatient;
  /** Diagnoses of the encounters billed on the invoice. */
  diagnoses: Array<{ encounterId: string; codeSystemKey: string | null; code: string | null; display: string; rank: "primary" | "secondary"; status: string }>;
}

export interface ClaimSourcePatient {
  id: string;
  patientNumber: string;
  familyName: string;
  givenName: string;
  middleName: string | null;
  suffix: string | null;
  sex: string;
  birthDate: string;
  /** The patient's recorded PhilHealth identification number (identifier type `philhealth_pin`), if any. */
  philhealthPin: string | null;
}

export interface AccreditationSource {
  accreditationNumber: string;
  validFrom: string | null;
  validUntil: string | null;
}

export type ReadinessCode =
  "invoice_not_issued" | "no_philhealth_coverage" | "member_pin_missing" | "accreditation_missing" | "accreditation_not_valid" | "diagnosis_code_missing";

export interface ReadinessCheck {
  code: ReadinessCode;
  ok: boolean;
  message: string;
}

const ICD10_KEYS = new Set(["icd-10", "icd10"]);

/**
 * Checks of the platform's OWN data before a claim can be prepared: is the
 * information a claim will obviously need recorded at all? PhilHealth's rules
 * (eligibility, benefit packages, case rates, filing windows, required
 * attachments) are not modelled here — they come with the official
 * specification.
 */
export function claimReadiness(src: ClaimSources, accreditation: AccreditationSource | null): ReadinessCheck[] {
  const { invoice } = src;
  const coverage = philhealthCoverage(src);
  const dates = invoice.items.map((i) => i.serviceDate).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  const accreditationValid =
    !!accreditation &&
    (!accreditation.validFrom || !from || accreditation.validFrom <= from) &&
    (!accreditation.validUntil || !to || accreditation.validUntil >= to);
  return [
    { code: "invoice_not_issued", ok: invoice.status === "issued", message: "The invoice is issued" },
    { code: "no_philhealth_coverage", ok: !!coverage, message: "The invoice has a PhilHealth coverage line" },
    { code: "member_pin_missing", ok: !!src.patient.philhealthPin, message: "The patient's PhilHealth identification number is recorded" },
    { code: "accreditation_missing", ok: !!accreditation, message: "The facility's PhilHealth accreditation number is recorded" },
    // Only meaningful once a number is recorded.
    ...(accreditation
      ? [{ code: "accreditation_not_valid" as const, ok: accreditationValid, message: "The recorded accreditation covers the dates of service" }]
      : []),
    {
      code: "diagnosis_code_missing",
      ok: codedDiagnoses(src).length > 0,
      message: "A billed encounter has an ICD-10 coded diagnosis",
    },
  ];
}

export function isReady(checks: ReadinessCheck[]): boolean {
  return checks.every((c) => c.ok);
}

/** Builds the package; call only when the readiness checks pass. */
export function buildClaimPackage(src: ClaimSources, accreditation: AccreditationSource | null): PhilHealthClaimPackage {
  const { invoice, patient } = src;
  const coverage = philhealthCoverage(src);
  if (invoice.status !== "issued" || !invoice.invoiceNumber || !invoice.issuedAt || !coverage) {
    throw new Error("A claim package needs an issued invoice with PhilHealth coverage");
  }
  const dates = invoice.items.map((i) => i.serviceDate).sort();
  return {
    model: "platform-claim-1",
    invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, issuedAt: invoice.issuedAt, facilityId: invoice.facilityId },
    facility: { accreditationNumber: accreditation?.accreditationNumber ?? null },
    patient: {
      id: patient.id,
      patientNumber: patient.patientNumber,
      familyName: patient.familyName,
      givenName: patient.givenName,
      middleName: patient.middleName,
      suffix: patient.suffix,
      sex: patient.sex,
      birthDate: patient.birthDate,
      philhealthPin: patient.philhealthPin,
    },
    coverage: { invoicePayerId: coverage.id, amountClaimed: coverage.amount, reference: coverage.reference },
    servicePeriod: { from: dates[0] ?? invoice.issuedAt.slice(0, 10), to: dates[dates.length - 1] ?? invoice.issuedAt.slice(0, 10) },
    diagnoses: codedDiagnoses(src)
      .sort((a, b) => (a.rank === b.rank ? a.code!.localeCompare(b.code!) : a.rank === "primary" ? -1 : 1))
      .map((d) => ({ codeSystem: "icd-10", code: d.code!, display: d.display, primary: d.rank === "primary" })),
    services: invoice.items.map((i) => ({
      description: i.description,
      category: i.category,
      serviceDate: i.serviceDate,
      quantity: i.quantity,
      grossAmount: i.grossAmount,
      discountAmount: i.discountAmount,
      netAmount: i.netAmount,
    })),
    totals: { gross: invoice.grossTotal, discount: invoice.discountTotal, net: invoice.netTotal },
  };
}

/** SHA-256 of the package in a canonical form (sorted keys): what was prepared, without storing it. */
export function packageDigest(claim: PhilHealthClaimPackage): string {
  return payloadDigest(claim);
}

/** "•••• 9012": enough to recognise the number on screen without exposing it. */
export function maskPin(pin: string | null): string | null {
  if (!pin) return null;
  return `•••• ${pin.replace(/\D/g, "").slice(-4)}`;
}

function philhealthCoverage(src: ClaimSources) {
  return src.invoice.payers.find((p) => p.payerType === "philhealth");
}

function codedDiagnoses(src: ClaimSources) {
  return src.diagnoses.filter((d) => d.status !== "entered_in_error" && d.code && d.codeSystemKey && ICD10_KEYS.has(d.codeSystemKey.toLowerCase()));
}
