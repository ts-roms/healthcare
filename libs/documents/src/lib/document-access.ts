import type { DocumentCategory } from "./document.schema";

/**
 * Least privilege for the generic document routes (`GET /documents`, `/documents/:id`, `/documents/:id/download-url`;
 * docs/security/zero-trust-audit-2026-11-06.md, A3). `document.read` opens the patient record's ordinary documents;
 * a category a domain guards with its own permission needs that permission as well, so the generic route is never a
 * way around the domain's own gate. Domain routes (dental imaging, outside results, messages, FHIR Binary, records
 * requests) check their own permission and call the service without this rule.
 *
 * - `null`: `document.read` is enough.
 * - a permission: needed in addition (the records office, `patient.records-request.manage`, may open every category of
 *   the patient's record, because it prepares copies of it).
 * - `"never"`: not served by the generic routes at all (its domain has its own download, which re-checks access).
 */
export const DOCUMENT_CATEGORY_PERMISSION: Readonly<Record<DocumentCategory, string | null | "never">> = {
  consent_form: null,
  identification: null,
  medical_certificate: null,
  referral_letter: null,
  prescription: null,
  clinical_attachment: null,
  other: null,
  laboratory_report: "lab.result.read",
  imaging: "dental.imaging.read",
  outside_result: "outside-result.read",
  billing: "billing.charge.read",
  record_copy: "patient.records-request.manage",
  // Management report files are downloaded through /management/reports, which re-checks each gated section.
  management_report: "never",
};

const RECORDS_OFFICE = "patient.records-request.manage";

/** Whether the generic document routes may show or serve a document of `category` to holders of `permissions`. */
export function documentCategoryReadable(category: DocumentCategory, permissions: ReadonlySet<string>): boolean {
  const needed = DOCUMENT_CATEGORY_PERMISSION[category];
  if (needed === "never") return false;
  if (needed === null) return true;
  return permissions.has(needed) || permissions.has(RECORDS_OFFICE);
}
