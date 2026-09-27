import type { DocumentReference } from "fhir/r4";
import type { DocumentSource, FhirContext } from "./sources";
import { compact, localSystem, ref } from "./support";
import { LAB_REPORT_CODE } from "./terminology";

/** Display names for the platform's own document categories (a local code system: no official one is claimed). */
const CATEGORY_DISPLAY: Record<string, string> = {
  consent_form: "Consent form",
  identification: "Identification",
  medical_certificate: "Medical certificate",
  laboratory_report: "Laboratory report",
  imaging: "Imaging",
  referral_letter: "Referral letter",
  prescription: "Prescription",
  clinical_attachment: "Clinical attachment",
  billing: "Billing document",
  other: "Other document",
};

/** Where a document's content is served: an authenticated read on this endpoint (never an object-store URL). */
export function documentContentUrl(ctx: FhirContext, documentId: string): string {
  return `${ctx.baseUrl}/Binary/${documentId}`;
}

/**
 * A stored document as a DocumentReference. The attachment carries metadata and a URL on this endpoint that
 * requires the caller's token (and `document.read`) and answers with a short-lived signed download.
 */
export function toDocumentReference(ctx: FhirContext, patientId: string, d: DocumentSource): DocumentReference {
  const display = CATEGORY_DISPLAY[d.category] ?? d.category.replace(/_/g, " ");
  return compact<DocumentReference>({
    resourceType: "DocumentReference",
    id: d.id,
    // Reliable: after upload an exported document changes only when a newer version supersedes it (archiving withdraws it).
    meta: { lastUpdated: d.supersededAt ?? d.uploadedAt },
    status: d.supersededAt ? "superseded" : "current",
    type: {
      coding: [
        ...(d.category === "laboratory_report" ? [{ ...LAB_REPORT_CODE }] : []),
        { system: localSystem(ctx, "codesystem/document-category"), code: d.category, display },
      ],
      text: display,
    },
    subject: ref("Patient", patientId),
    date: d.uploadedAt,
    custodian: ref("Organization", ctx.organization.id, ctx.organization.name),
    relatesTo: d.replaces.map((id) => ({ code: "replaces" as const, target: ref("DocumentReference", id) })),
    description: d.title,
    content: [
      {
        attachment: {
          contentType: d.contentType,
          url: documentContentUrl(ctx, d.id),
          size: d.sizeBytes,
          title: d.fileName,
          creation: d.uploadedAt,
        },
      },
    ],
    context: d.related.length ? { related: d.related.map((r) => ref(r.type, r.id)) } : undefined,
  });
}
