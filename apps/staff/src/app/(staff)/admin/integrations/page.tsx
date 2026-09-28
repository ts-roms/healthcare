import Link from "next/link";
import { redirect } from "next/navigation";
import { BanIcon, CheckCircle2Icon, ClockIcon, PlugZapIcon, TriangleAlertIcon, XCircleIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { ExchangeReviewItem, ExchangeReviewList, PayloadKeyOverview } from "@/lib/api/types";
import { operationLabel, sourceLink } from "./exchange-labels";
import { ExchangeRowActions } from "./exchange-row-actions";
import { PayloadKeys } from "./payload-keys";

export const metadata = { title: "Integrations" };

const STATUS: Record<ExchangeReviewItem["status"], { label: string; variant: "success" | "danger" | "warning" | "info" | "neutral"; icon: typeof ClockIcon }> =
  {
    queued: { label: "Queued", variant: "info", icon: ClockIcon },
    accepted: { label: "Accepted", variant: "success", icon: CheckCircle2Icon },
    rejected: { label: "Rejected", variant: "danger", icon: XCircleIcon },
    failed: { label: "Failed", variant: "danger", icon: TriangleAlertIcon },
    not_configured: { label: "Not connected", variant: "neutral", icon: PlugZapIcon },
  };

function Status({ exchange }: { exchange: ExchangeReviewItem }) {
  if (exchange.stalled) {
    return (
      <Badge variant="warning">
        <TriangleAlertIcon aria-hidden /> Stalled
      </Badge>
    );
  }
  const { label, variant, icon: Icon } = STATUS[exchange.status];
  return (
    <Badge variant={exchange.resolvedAt ? "neutral" : variant}>
      {exchange.resolvedAt ? <BanIcon aria-hidden /> : <Icon aria-hidden />} {label}
      {exchange.resolvedAt ? " · resolved" : ""}
    </Badge>
  );
}

/**
 * Outbound integration exchanges (PhilHealth, DOH, …) for administrators: what
 * failed, was rejected or could not be sent, and what looks stalled. Fix the cause
 * at the source and prepare the request again there, re-queue a stalled one, or
 * record a resolution. Payloads are never shown.
 */
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "integration.exchange.manage")) redirect("/");
  const view = params.view === "all" ? "all" : "attention";
  const [{ summary, exchanges }, keys] = await Promise.all([
    api<ExchangeReviewList>("/integrations/exchanges", { query: { view } }),
    // Key rotation is a platform operation: only platform administrators see the key ring's usage.
    session.user.isPlatformAdmin ? api<PayloadKeyOverview>("/integrations/payload-keys").catch(() => null) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Requests the integration worker sends to external systems. Those that did not succeed need someone to look at them."
      />
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="View" className="flex gap-1">
            <Button asChild size="sm" variant={view === "attention" ? "default" : "outline"}>
              <Link href="/admin/integrations" aria-current={view === "attention" ? "page" : undefined}>
                Needs attention ({summary.needsReview + summary.stalled})
              </Link>
            </Button>
            <Button asChild size="sm" variant={view === "all" ? "default" : "outline"}>
              <Link href="/admin/integrations?view=all" aria-current={view === "all" ? "page" : undefined}>
                All recent
              </Link>
            </Button>
          </nav>
          <p className="text-meta text-muted-foreground">
            {summary.needsReview} unsuccessful and unresolved · {summary.stalled} stalled · {summary.queued} queued
          </p>
        </div>
        <Card className="py-0">
          {exchanges.length === 0 ? (
            <p className="p-4 text-body text-muted-foreground">{view === "attention" ? "Nothing needs attention." : "No exchanges yet."}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requested</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {exchanges.map((e) => {
                  const link = sourceLink(e);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap">{clinicalDateTime(e.requestedAt)}</TableCell>
                      <TableCell>
                        <div>{operationLabel(e)}</div>
                        {link ? (
                          <Link className="text-meta underline-offset-2 hover:underline" href={link.href}>
                            {link.label}
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {e.patient ? (
                          <>
                            {e.patient.displayName} <span className="text-muted-foreground">· {e.patient.patientNumber}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Status exchange={e} />
                        <div className="text-meta text-muted-foreground">
                          {e.attempts} attempt{e.attempts === 1 ? "" : "s"}
                          {e.lastAttemptAt ? ` · last ${clinicalDateTime(e.lastAttemptAt)}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-md text-meta">
                        {e.externalReference ? <div>Ref. {e.externalReference}</div> : null}
                        {e.outcomeDetail.reasons?.map((r) => (
                          <div key={r.code}>
                            {r.code}: {r.message}
                          </div>
                        ))}
                        {e.lastError ? <div className="text-muted-foreground">{e.lastError}</div> : null}
                        {e.resolutionNote ? <div>Resolved: {e.resolutionNote}</div> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <ExchangeRowActions exchange={e} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
        {keys ? <PayloadKeys overview={keys} /> : null}
      </div>
    </>
  );
}
