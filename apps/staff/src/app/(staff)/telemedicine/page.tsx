import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertOctagonIcon, ClockIcon, VideoIcon } from "lucide-react";
import { clinicalTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { LiveQueueRefresh } from "@/components/live-queue";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { TelemedicineDay } from "@/lib/api/types";
import { consultationOrder, sessionLabel } from "@/lib/telemedicine-mapping";

export const metadata = { title: "Online consultations" };

export default async function TelemedicinePage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "telemedicine.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Online consultations" />
        <FacilityRequired action="Online consultations belong to a facility." />
      </>
    );
  }
  const day = await api<TelemedicineDay>("/telemedicine/consultations");
  const rows = consultationOrder(day.consultations);
  return (
    <>
      <PageHeader
        title="Online consultations"
        description={`${facility.name} · today${day.videoConfigured ? "" : " · video is not configured: call patients on their callback number"}`}
        actions={can(session, "clinic.queue.read") ? <LiveQueueRefresh /> : null}
      />
      <div className="p-4">
        {rows.length === 0 ? (
          <p className="text-body text-muted-foreground">No online consultations today. Book them as appointments with an online visit type.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Time</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Practitioner</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ appointment, patient, session: s }) => (
                <TableRow key={appointment.id}>
                  <TableCell className="tabular">{clinicalTime(appointment.startsAt)}</TableCell>
                  <TableCell>
                    <span className="font-medium">{patient?.displayName ?? "Patient"}</span>
                    <span className="block text-meta text-muted-foreground">{patient ? `${patient.patientNumber} · ${patient.age} y` : null}</span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={s.status === "waiting" ? "warning" : s.status === "in_consultation" ? "info" : "neutral"}>
                        {s.status === "waiting" ? <ClockIcon aria-hidden /> : <VideoIcon aria-hidden />} {sessionLabel(s)}
                      </Badge>
                      {s.status === "waiting" && s.patientJoinedAt ? (
                        <span className="text-meta text-muted-foreground">since {clinicalTime(s.patientJoinedAt)}</span>
                      ) : null}
                      {s.redFlags.length ? (
                        <Badge variant="critical">
                          <AlertOctagonIcon aria-hidden /> {s.redFlags.length} red flag{s.redFlags.length === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-table">{appointment.practitionerName}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="xs" variant={s.status === "waiting" ? "default" : "outline"}>
                      <Link href={s.encounterId ? `/clinic/encounters/${s.encounterId}` : `/telemedicine/${appointment.id}`}>
                        {s.encounterId ? "Open consultation" : s.status === "waiting" ? "Review and start" : "Review answers"}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
