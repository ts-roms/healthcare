import { FileSignatureIcon, FolderOpenIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { portalApi } from "@/lib/api/client";
import type { PortalDocuments } from "@/lib/api/types";
import { requestOpen } from "@/lib/documents";
import { formatCalendarDate } from "@/lib/greeting";
import { OpenFile } from "./open-file";
import { RecordsRequestForm } from "./records-request-form";
import { RequestCard } from "./request-card";

export const metadata = { title: "Documents" };

/** The patient's medical certificates and their requests for copies of their records. */
export default async function DocumentsPage() {
  const { certificates, requests } = await portalApi<PortalDocuments>("/portal/documents");
  const openCount = requests.filter((r) => requestOpen(r.status)).length;
  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-page-lg font-semibold">Documents</h1>
        <p className="text-body text-muted-foreground">Your medical certificates, and copies of your records you asked the clinic for.</p>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="certificates">
        <h2 id="certificates" className="text-section font-semibold">
          Medical certificates
        </h2>
        {certificates.length === 0 ? (
          <EmptyState icon={FileSignatureIcon} title="No certificates yet">
            When your doctor issues a medical certificate after a visit, you can download it here.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {certificates.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                  <FileSignatureIcon className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-semibold">{c.purpose}</span>
                  <span className="text-meta text-muted-foreground">
                    Visit of {formatCalendarDate(c.examinedOn)}
                    {c.practitionerName ? ` · ${c.practitionerName}` : ""}
                    {c.restDays ? ` · ${c.restDays} day${c.restDays === 1 ? "" : "s"} of rest` : ""} · no. {c.certificateNumber}
                  </span>
                </span>
                <OpenFile kind="certificate" id={c.id} label="Download" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="requests">
        <h2 id="requests" className="text-section font-semibold">
          Copies of your records
        </h2>
        <p className="text-meta text-muted-foreground">
          Ask the clinic&apos;s records office for copies of your records. They check your request and share the copies here, or tell you why they cannot.
          Results, prescriptions and care plans you already see in MyHealth do not need a request.
        </p>
        <RecordsRequestForm canSubmit={openCount < 3} />
        {requests.length === 0 ? (
          <EmptyState icon={FolderOpenIcon} title="No requests yet">
            Your requests and the clinic&apos;s answers will appear here.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {requests.map((r) => (
              <li key={r.id}>
                <RequestCard request={r} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
