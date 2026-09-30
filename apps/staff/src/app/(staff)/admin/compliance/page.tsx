import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { ComplianceOverview } from "@/lib/api/types";
import { COMPLIANCE_AREAS } from "./areas";
import { ComplianceReviewForm } from "./review-form";

export const metadata = { title: "Compliance" };

const day = (d: string) => clinicalDate(`${d}T12:00:00Z`);

/**
 * Compliance configuration: the platform encodes no government rule; each area is configured by the organization and
 * validated by its advisers. This page keeps the record of who reviewed what, when and against what.
 */
export default async function CompliancePage() {
  const session = await getSession();
  if (!can(session, "compliance.review.manage")) redirect("/");
  const overview = await api<ComplianceOverview>("/compliance/reviews");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  return (
    <>
      <PageHeader
        title="Compliance"
        description="Your organization's own configuration for tax, procurement, controlled drugs, laboratory licensing, DOH reporting, data privacy and dental estimates, and who validated it."
      />
      <div className="flex flex-col gap-4 p-4">
        <p className="rounded-md border border-dashed p-3 text-meta text-muted-foreground">
          The platform does not know BIR, Dangerous Drugs Board, DOH, National Privacy Commission or procurement rules. Everything in these areas is entered by
          your organization. Have each area checked against the current official requirements by the right adviser, and record the review here. A recorded
          review is your evidence, not a certification.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {overview.areas.map(({ area, latest }) => {
            const info = COMPLIANCE_AREAS[area];
            return (
              <Card key={area}>
                <CardHeader>
                  <CardTitle>{info.label}</CardTitle>
                  {latest ? (
                    latest.outcome === "validated" ? (
                      <Badge variant="success" className="ml-auto">
                        <CircleCheckIcon aria-hidden /> Validated {day(latest.reviewedOn)}
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="ml-auto">
                        <CircleAlertIcon aria-hidden /> Changes needed
                      </Badge>
                    )
                  ) : (
                    <Badge variant="neutral" className="ml-auto">
                      <CircleDashedIcon aria-hidden /> Not reviewed
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-table">
                  <p className="text-muted-foreground">
                    {info.covers}.{" "}
                    <Link className="text-primary hover:underline" href={info.href}>
                      Open the settings
                    </Link>
                  </p>
                  {latest ? (
                    <p>
                      {latest.reviewerName} ({latest.reviewerRole}), {day(latest.reviewedOn)}: {latest.reference}
                      {latest.note ? <span className="block text-meta text-muted-foreground">{latest.note}</span> : null}
                    </p>
                  ) : null}
                  <ComplianceReviewForm area={area} today={today} />
                </CardContent>
              </Card>
            );
          })}
        </div>
        {overview.history.length > 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>All reviews</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-table">
                {overview.history.map((r) => (
                  <li key={r.id}>
                    {day(r.reviewedOn)} · {COMPLIANCE_AREAS[r.area].label} · {r.outcome === "validated" ? "Validated" : "Changes needed"} · {r.reviewerName}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
