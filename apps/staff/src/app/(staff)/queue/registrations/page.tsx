import { ModulePage } from "@/components/module-page";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClockIcon, UsersIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { LiveRegistrationsRefresh } from "@/components/live-queue";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { KioskRegistrationItem } from "@/lib/api/types";

export const metadata = { title: "Registrations" };

/**
 * New patients who typed their details at a kiosk. They are not patients yet: reception checks who they are, looks at
 * possible duplicates and approves, links to an existing record or declines. The list holds no personal data.
 */
export default async function KioskRegistrationsPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "kiosk.registration.review")) redirect("/");
  if (!facility) {
    return (
      <ModulePage title="Registrations">
        <FacilityRequired action="Kiosk registrations belong to a facility." />
      </ModulePage>
    );
  }
  const { items } = await api<{ items: KioskRegistrationItem[] }>("/kiosk/admin/registrations");
  return (
    <ModulePage
      title="Registrations"
      description="New patients who registered at a kiosk. Check who they are, look at possible duplicates, then approve, link to an existing record or decline. Nothing is a patient record until you approve it."
      actions={<LiveRegistrationsRefresh />}
    >
      <Card className="py-0">
        {items.length === 0 ? (
          <p className="flex items-center gap-2 p-4 text-body text-muted-foreground">
            <UsersIcon className="size-4" aria-hidden /> No registrations are waiting.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Kiosk</TableHead>
                <TableHead>Possible duplicates</TableHead>
                <TableHead>Kept until</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono font-medium">{r.reference}</TableCell>
                  <TableCell>{clinicalDateTime(r.submittedAt)}</TableCell>
                  <TableCell>{r.kiosk}</TableCell>
                  <TableCell>
                    {r.possibleDuplicates > 0 ? (
                      <Badge variant="warning">
                        {r.possibleDuplicates} possible match{r.possibleDuplicates === 1 ? "" : "es"}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">None found</span>
                    )}
                  </TableCell>
                  <TableCell className="text-meta text-muted-foreground">
                    <ClockIcon className="mr-1 inline size-3.5" aria-hidden />
                    {clinicalDateTime(r.expiresAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="xs" variant="outline">
                      <Link href={`/queue/registrations/${r.id}`}>Review</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </ModulePage>
  );
}
