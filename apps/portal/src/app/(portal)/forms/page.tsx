import { FileSignatureIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { portalApi } from "@/lib/api/client";
import type { PortalForm } from "@/lib/api/types";
import { formatCalendarDate } from "@/lib/greeting";
import { SignForm } from "./sign-form";

export const metadata = { title: "Forms to sign" };

/** Consent forms the clinic asked the patient (or, for a minor, their parent or guardian) to read and sign. */
export default async function FormsPage() {
  const forms = await portalApi<PortalForm[]>("/portal/forms");
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-semibold">Forms to sign</h1>
        <p className="text-body text-muted-foreground">Read each form carefully. Nothing is signed until you draw your signature and send it.</p>
      </header>
      {forms.length === 0 ? (
        <EmptyState icon={FileSignatureIcon} title="Nothing to sign">
          When your clinic asks you to sign a form, it appears here.
        </EmptyState>
      ) : (
        forms.map((form) => (
          <section key={form.id} aria-label={form.procedureName} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <div>
              <h2 className="text-section font-semibold">{form.wording.title}</h2>
              <p className="text-meta text-muted-foreground">
                {form.procedureName} · {form.facilityName} · open until {formatCalendarDate(form.expiresAt.slice(0, 10))}
              </p>
            </div>
            <div className="flex flex-col gap-2 text-body">
              {form.wording.body.split(/\n{2,}/).map((paragraph, i) => (
                <p key={i}>{paragraph.replace(/\s*\n\s*/g, " ")}</p>
              ))}
            </div>
            <SignForm form={form} />
          </section>
        ))
      )}
    </div>
  );
}
