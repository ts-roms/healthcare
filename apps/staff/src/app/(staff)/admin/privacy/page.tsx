import Link from "next/link";
import { redirect } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { PrivacyIncident, PrivacySetting } from "@/lib/api/types";
import { notificationClock, PRIVACY_ASSESSMENT, PRIVACY_CATEGORY_LABEL } from "@/lib/privacy-mapping";
import { NewIncidentForm, PrivacySettingForm } from "./privacy-forms";

export const metadata = { title: "Data privacy" };

const VIEWS = [
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;

/**
 * The personal data breach register and the organization's privacy settings (docs/security/data-privacy-act.md). The
 * platform encodes no NPC rule: the notification window is the organization's own, and every assessment and
 * notification is recorded as the Data Protection Officer made it.
 */
export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "privacy.incident.manage")) redirect("/");
  const view = VIEWS.find((v) => v.key === params.view)?.key ?? "open";
  const [incidents, setting] = await Promise.all([
    api<PrivacyIncident[]>("/privacy/incidents", { query: { status: view } }),
    api<PrivacySetting>("/privacy/setting"),
  ]);
  return (
    <>
      <PageHeader
        title="Data privacy"
        description="Your organization's personal data breach register and its privacy settings. The platform counts the hours of your own notification window and keeps what you record; it decides nothing and notifies no one. Opening the register is recorded."
      />
      <div className="flex flex-col gap-4 p-4">
        <p className="rounded-md border border-dashed p-3 text-meta text-muted-foreground">
          Record every security incident that may involve personal data as soon as it is discovered, assess with your Data Protection Officer whether it must be
          notified under the Data Privacy Act and the National Privacy Commission&apos;s current rules, and record each notification you make. Keep patient
          names out of these notes; the register is evidence of what your organization did, not a case file.
        </p>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card className="py-0">
            <CardHeader className="pt-4">
              <CardTitle>Breach register</CardTitle>
              <nav aria-label="View" className="ml-auto flex gap-1">
                {VIEWS.map((v) => (
                  <Button key={v.key} asChild size="xs" variant={view === v.key ? "default" : "outline"}>
                    <Link href={v.key === "open" ? "/admin/privacy" : `/admin/privacy?view=${v.key}`} aria-current={view === v.key ? "page" : undefined}>
                      {v.label}
                    </Link>
                  </Button>
                ))}
              </nav>
            </CardHeader>
            {incidents.length === 0 ? (
              <p className="p-4 text-body text-muted-foreground">{view === "open" ? "No open incidents." : "No incidents recorded."}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Incident</TableHead>
                    <TableHead>Data involved</TableHead>
                    <TableHead>Assessment</TableHead>
                    <TableHead>Notification</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.map((i) => {
                    const clock = notificationClock(i);
                    return (
                      <TableRow key={i.id}>
                        <TableCell>
                          <span className="font-medium">{i.title}</span>
                          <span className="block text-meta text-muted-foreground">
                            {i.incidentNumber} · discovered {clinicalDateTime(i.discoveredAt)}
                            {i.affectedEstimate !== null ? ` · about ${i.affectedEstimate} affected` : ""}
                          </span>
                        </TableCell>
                        <TableCell className="text-meta">{i.dataCategories.map((c) => PRIVACY_CATEGORY_LABEL[c]).join(", ")}</TableCell>
                        <TableCell>
                          <Badge variant={PRIVACY_ASSESSMENT[i.assessment].variant}>{PRIVACY_ASSESSMENT[i.assessment].label}</Badge>
                        </TableCell>
                        <TableCell className="text-meta">
                          {i.status === "closed" ? (
                            "Closed"
                          ) : i.npcNotifiedAt ? (
                            `NPC notified ${clinicalDateTime(i.npcNotifiedAt)}`
                          ) : clock ? (
                            <span className={i.notificationOverdue ? "font-medium text-danger-foreground" : undefined}>
                              {i.notificationOverdue ? <TriangleAlertIcon className="mr-1 inline size-3.5" aria-hidden /> : null}
                              {clock}
                            </span>
                          ) : (
                            "Not needed"
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="xs" variant="outline">
                            <Link href={`/admin/privacy/${i.id}`}>Open</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            <CardContent className="border-t py-4">
              <NewIncidentForm />
            </CardContent>
          </Card>
          <div className="flex flex-col gap-4">
            <PrivacySettingForm setting={setting} />
            <Card>
              <CardHeader>
                <CardTitle>Where the rest lives</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-table">
                <Link className="text-primary hover:underline" href="/records/requests">
                  Patients&apos; requests: copies, corrections, erasure, objections
                </Link>
                <Link className="text-primary hover:underline" href="/admin/consent-wording">
                  Consent wording patients read in MyHealth
                </Link>
                <Link className="text-primary hover:underline" href="/records/retention">
                  Document retention periods and review
                </Link>
                <Link className="text-primary hover:underline" href="/admin/audit">
                  Audit trail
                </Link>
                <Link className="text-primary hover:underline" href="/admin/compliance">
                  Record the Data Protection Officer&apos;s review
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
