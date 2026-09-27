"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ClockIcon, VideoIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from "@healthcare/ui/primitives";
import { QuestionnaireSummary } from "@/components/questionnaire-summary";
import type { TelemedicineConsultation } from "@/lib/api/types";
import { sessionLabel } from "@/lib/telemedicine-mapping";
import { startConsultation } from "../actions";

/** Before the call: the questionnaire, and Start once the patient is in the waiting room. */
export function PreConsult({ consultation, canConduct }: { consultation: TelemedicineConsultation; canConduct: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const { appointment, session } = consultation;
  const waiting = session.status === "waiting";

  // The patient may enter the waiting room at any moment.
  React.useEffect(() => {
    if (session.status !== "scheduled") return;
    const timer = window.setInterval(() => router.refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [session.status, router]);

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader>
          <CardTitle>Pre-consult answers</CardTitle>
        </CardHeader>
        <CardContent>
          <QuestionnaireSummary session={session} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Consultation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-table">
          <p>
            {clinicalDateTime(appointment.startsAt)} · {appointment.practitionerName}
          </p>
          <Badge variant={waiting ? "warning" : "neutral"} className="self-start">
            <ClockIcon aria-hidden /> {sessionLabel(session)}
          </Badge>
          {session.status === "scheduled" ? <p className="text-muted-foreground">Start becomes available when the patient enters the waiting room.</p> : null}
          {session.status === "escalated" || session.status === "ended" ? <p className="text-muted-foreground">This consultation is closed.</p> : null}
          {canConduct && waiting ? (
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await startConsultation(appointment.id);
                  if (!result.ok) return void toast.error(result.message);
                  router.push(`/clinic/encounters/${result.data.session.encounterId}`);
                })
              }
            >
              <VideoIcon /> Start consultation
            </Button>
          ) : null}
          {!consultation.videoConfigured ? (
            <p className="text-meta text-muted-foreground">Video is not configured: call the patient on the callback number.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
