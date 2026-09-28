import type { DocumentReference } from "fhir/r4";
import { dentalImageKind } from "./dental";
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

/** The later of two ISO instants (both from the same serializer, so they compare as text). */
const later = (a: string, b: string | undefined) => (b && b > a ? b : a);

/**
 * A stored document as a DocumentReference. The attachment carries metadata and a URL on this endpoint that
 * requires the caller's token (and `document.read`) and answers with a short-lived signed download.
 *
 * A dental radiograph or photo adds what the dental record says about it: the kind of image as `category`, the teeth
 * shown in the description, the visit and the date taken as `context`. When the dental record marks the image entered
 * in error, the DocumentReference is `entered-in-error` (the platform's rule for records in error).
 */
export function toDocumentReference(ctx: FhirContext, patientId: string, d: DocumentSource): DocumentReference {
  const display = CATEGORY_DISPLAY[d.category] ?? d.category.replace(/_/g, " ");
  const image = d.dentalImage ?? undefined;
  return compact<DocumentReference>({
    resourceType: "DocumentReference",
    id: d.id,
    // Reliable: after upload an exported document changes only when a newer version supersedes it (archiving withdraws
    // it), or when the dental record describes it or marks that description entered in error (immutable otherwise).
    meta: { lastUpdated: image?.enteredInErrorAt ?? later(d.supersededAt ?? d.uploadedAt, image?.recordedAt) },
    status: image?.status === "entered_in_error" ? "entered-in-error" : d.supersededAt ? "superseded" : "current",
    type: {
      coding: [
        ...(d.category === "laboratory_report" ? [{ ...LAB_REPORT_CODE }] : []),
        { system: localSystem(ctx, "codesystem/document-category"), code: d.category, display },
      ],
      text: display,
    },
    category: image ? [dentalImageKind(ctx, image)] : undefined,
    subject: ref("Patient", patientId),
    date: d.uploadedAt,
    custodian: ref("Organization", ctx.organization.id, ctx.organization.name),
    relatesTo: d.replaces.map((id) => ({ code: "replaces" as const, target: ref("DocumentReference", id) })),
    description: image?.teeth.length ? `${d.title} (teeth ${image.teeth.join(", ")}, FDI)` : d.title,
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
    context:
      d.related.length || image
        ? compact({
            encounter: image?.encounterId ? [ref("Encounter", image.encounterId)] : undefined,
            period: image ? { start: image.takenOn } : undefined,
            related: d.related.map((r) => ref(r.type, r.id)),
          })
        : undefined,
  });
}
