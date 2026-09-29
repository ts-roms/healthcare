"use client";

import * as React from "react";
import { MedicalDocument, type MedicalDocumentProps } from "@healthcare/ui/healthcare";
import { toast } from "@healthcare/ui/primitives";
import type { ActionResult } from "@/lib/api/action-result";
import type { PatientWorkspace } from "@/lib/api/types";
import { filedUnderText } from "@/lib/patient-merge";
import { label } from "@/lib/patient-mapping";
import { dentalImageLink } from "@/app/(staff)/dental/actions";
import { workspaceDocumentLink } from "./actions";

const DOCUMENT_KIND: Record<string, MedicalDocumentProps["kind"]> = {
  consent_form: "consent",
  medical_certificate: "certificate",
  imaging: "imaging",
  laboratory_report: "result",
  referral_letter: "referral",
};

/**
 * Dental images and uploaded documents as links. Each opening asks the API for a short-lived signed link (checked and
 * audited there); the tab is opened first so pop-up blockers allow it.
 */
export function WorkspaceFiles({
  images,
  documents,
}: {
  images: NonNullable<PatientWorkspace["dentalImages"]> | null;
  documents: NonNullable<PatientWorkspace["documents"]> | null;
}) {
  const [pending, setPending] = React.useState<string | null>(null);
  const open = (key: string, link: () => Promise<ActionResult<{ url: string }>>) => async () => {
    setPending(key);
    const tab = window.open("", "_blank");
    try {
      const result = await link();
      if (result.ok && tab) {
        tab.opener = null;
        tab.location.href = result.data.url;
      } else {
        tab?.close();
        toast.error(result.ok ? "Allow pop-ups to open the file." : result.message);
      }
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {(images ?? []).map((i) => (
        <MedicalDocument
          key={`image:${i.id}`}
          kind="imaging"
          title={`${label(i.kind)}${i.teeth.length ? ` · tooth ${i.teeth.join(", ")}` : ""}`}
          date={i.takenOn}
          author={[i.facility?.name, filedUnderText(i.filedUnder)].filter(Boolean).join(" · ") || undefined}
          pending={pending === `image:${i.id}`}
          onOpen={open(`image:${i.id}`, () => dentalImageLink(i.id))}
        />
      ))}
      {(documents ?? []).map((d) => (
        <MedicalDocument
          key={`document:${d.id}`}
          kind={DOCUMENT_KIND[d.category] ?? "other"}
          title={d.title}
          date={d.uploadedAt}
          author={[label(d.category), filedUnderText(d.filedUnder)].filter(Boolean).join(" · ")}
          pending={pending === `document:${d.id}`}
          onOpen={open(`document:${d.id}`, () => workspaceDocumentLink(d.id))}
        />
      ))}
    </div>
  );
}
