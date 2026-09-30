import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { Referral } from "@/lib/api/types";
import { REFERRAL_STATUS, REFERRAL_URGENCY_LABEL, referralRecipient } from "@/lib/clinic-mapping";

export const metadata = { title: "Referrals" };

const VIEWS = [
  { key: "to_me", label: "Referred to me" },
  { key: "from_me", label: "Made by me" },
  { key: "open", label: "All open" },
  { key: "all", label: "All" },
] as const;

/** Referrals: to the signed-in practitioner, made by them, or the organization's open and recent ones. */
export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "encounter.read")) redirect("/");
  const view = VIEWS.find((v) => v.key === params.view)?.key ?? "to_me";
  const referrals = await api<Referral[]>("/referrals", { query: { view } });
  return (
    <>
      <PageHeader
        title="Referrals"
        description="Patients referred from consultations: to practitioners here, who accept or decline and complete them, or to outside providers, whose replies are recorded."
      />
      <div className="flex flex-col gap-3 p-4">
        <nav aria-label="View" className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <Button key={v.key} asChild size="sm" variant={view === v.key ? "default" : "outline"}>
              <Link href={`/clinic/referrals?view=${v.key}`} aria-current={view === v.key ? "page" : undefined}>
                {v.label}
              </Link>
            </Button>
          ))}
        </nav>
        <Card className="py-0">
          {referrals.length === 0 ? (
            <p className="p-4 text-body text-muted-foreground">No referrals here.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referral</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>From → to</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referrals.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link className="font-medium text-primary hover:underline" href={`/clinic/referrals/${r.id}`}>
                        {r.referralNumber}
                      </Link>
                      <span className="block text-meta text-muted-foreground">{clinicalDateTime(r.issuedAt)}</span>
                    </TableCell>
                    <TableCell>
                      {r.patient ? (
                        <>
                          {r.patient.displayName} <span className="text-muted-foreground">· {r.patient.patientNumber}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-meta">
                      {r.referringPractitioner?.displayName ?? "—"} → {referralRecipient(r)}
                      {r.specialty ? <span className="block text-muted-foreground">{r.specialty}</span> : null}
                    </TableCell>
                    <TableCell>{r.urgency === "routine" ? "Routine" : <Badge variant="warning">{REFERRAL_URGENCY_LABEL[r.urgency]}</Badge>}</TableCell>
                    <TableCell>
                      <Badge variant={REFERRAL_STATUS[r.status].variant}>{REFERRAL_STATUS[r.status].label}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
