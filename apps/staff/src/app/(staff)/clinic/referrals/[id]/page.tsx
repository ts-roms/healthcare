import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrinterIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { PageHeader } from "@/components/page-header";
import { ReferralOverdueBadge } from "@/components/referral-overdue-badge";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { AppointmentItem, Page, Referral } from "@/lib/api/types";
import { REFERRAL_STATUS, REFERRAL_URGENCY_LABEL, referralRecipient } from "@/lib/clinic-mapping";
import { fileHref } from "@/lib/files";
import { ReferralActions } from "./referral-actions";

export const metadata = { title: "Referral" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="text-muted-foreground">{label}: </span>
      {children}
    </p>
  );
}

/** One referral: what the referrer wrote (never changed), the answer, the appointment, the outcome, and what may be done next. */
export default async function ReferralPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, getSession()]);
  if (!can(session, "encounter.read")) redirect("/");
  if (!UUID.test(id)) notFound();
  let referral: Referral;
  try {
    referral = await api<Referral>(`/referrals/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const open = referral.status === "sent" || referral.status === "accepted";
  const canBook = referral.kind === "internal" && open && can(session, "appointment.manage");
  const upcoming =
    canBook && referral.toPractitionerId
      ? (
          await api<Page<AppointmentItem>>("/appointments", {
            query: { patientId: referral.patientId, practitionerId: referral.toPractitionerId, pageSize: 20 },
          }).catch(() => ({ items: [] as AppointmentItem[] }))
        ).items.filter((a) => a.status === "booked" || a.status === "confirmed")
      : [];
  const canComplete =
    can(session, "encounter.write") && (referral.kind === "internal" ? referral.status === "accepted" && referral.forYou : referral.status === "sent");
  const canCancel = open && (referral.byYou || can(session, "encounter.amend"));
  return (
    <>
      <PageHeader
        title={`Referral ${referral.referralNumber}`}
        description={`${referral.referringPractitioner?.displayName ?? "—"} → ${referralRecipient(referral)}`}
        actions={
          referral.status !== "cancelled" ? (
            <Button asChild size="sm" variant="outline">
              <a href={fileHref.referralLetter(referral.id)} target="_blank" rel="noreferrer">
                <PrinterIcon /> Letter
              </a>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 p-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>The referral</CardTitle>
            <span className="ml-auto flex flex-wrap gap-1">
              <ReferralOverdueBadge overdue={referral.overdue} />
              <Badge variant={REFERRAL_STATUS[referral.status].variant}>{REFERRAL_STATUS[referral.status].label}</Badge>
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <Row label="Patient">
              {referral.patient ? (
                <Link className="text-primary hover:underline" href={`/patients/${referral.patientId}`}>
                  {referral.patient.displayName} · {referral.patient.patientNumber}
                </Link>
              ) : (
                "—"
              )}
            </Row>
            <Row label="From">
              <Link className="text-primary hover:underline" href={`/clinic/encounters/${referral.encounterId}`}>
                {referral.referringPractitioner?.displayName ?? "—"}, {clinicalDateTime(referral.issuedAt)}
              </Link>
            </Row>
            <Row label="To">
              {referralRecipient(referral)}
              {referral.externalContact ? ` · ${referral.externalContact}` : ""}
            </Row>
            {referral.specialty ? <Row label="Specialty or service">{referral.specialty}</Row> : null}
            <Row label="Urgency">{REFERRAL_URGENCY_LABEL[referral.urgency]}</Row>
            <Row label="Reason">{referral.reason}</Row>
            {referral.clinicalSummary ? <Row label="Clinical summary">{referral.clinicalSummary}</Row> : null}
            {referral.diagnoses.length ? (
              <Row label="Diagnoses">{referral.diagnoses.map((d) => `${d.display}${d.code ? ` (${d.code})` : ""}`).join("; ")}</Row>
            ) : null}
            {referral.respondedAt ? (
              <Row label={referral.status === "declined" ? "Declined" : "Accepted"}>
                {clinicalDateTime(referral.respondedAt)}
                {referral.responseNote ? ` · ${referral.responseNote}` : ""}
              </Row>
            ) : null}
            {referral.appointmentId ? <Row label="Appointment">linked</Row> : null}
            {referral.completedAt ? (
              <Row label="Outcome">
                {referral.outcomeNote} <span className="text-muted-foreground">({clinicalDateTime(referral.completedAt)})</span>
                {referral.replyDocumentId ? <span className="block text-meta text-muted-foreground">Reply stored in the patient record.</span> : null}
              </Row>
            ) : null}
            {referral.cancelledAt ? (
              <Row label="Cancelled">
                {clinicalDateTime(referral.cancelledAt)} · {referral.cancelReason}
              </Row>
            ) : null}
          </CardContent>
        </Card>
        <ReferralActions
          referral={referral}
          canComplete={canComplete}
          canCancel={canCancel}
          canBook={canBook}
          appointments={upcoming}
          bookHref={
            canBook && referral.toPractitionerId
              ? `/appointments/new?patientId=${referral.patientId}&practitionerId=${referral.toPractitionerId}&returnTo=${encodeURIComponent(`/clinic/referrals/${referral.id}`)}`
              : null
          }
        />
      </div>
    </>
  );
}
