"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlusIcon, HospitalIcon, PhoneIcon, PhoneOffIcon, VideoIcon } from "lucide-react";
import { VideoCall } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import { QuestionnaireSummary } from "@/components/questionnaire-summary";
import type { TelemedicineConsultation, VideoJoin } from "@/lib/api/types";
import { sessionLabel } from "@/lib/telemedicine-mapping";
import { endConsultation, escalateConsultation, joinConsultation, saveInstructions } from "../../../telemedicine/actions";

/**
 * The online part of a telemedicine encounter, above the note: video (or the
 * callback number), the patient's pre-consult answers, and end / escalate to
 * in-person care. Documentation happens in the workspace as for any encounter.
 */
export function TelemedicinePanel({
  consultation,
  canConduct,
  bookInPersonHref,
}: {
  consultation: TelemedicineConsultation;
  canConduct: boolean;
  bookInPersonHref: string | null;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [video, setVideo] = React.useState<VideoJoin | null>(null);
  const [mode, setMode] = React.useState<"none" | "end" | "escalate">("none");
  const [instructions, setInstructions] = React.useState(consultation.session.patientInstructions ?? "");
  const [reason, setReason] = React.useState("");
  const { session, appointment } = consultation;
  const live = session.status === "in_consultation";
  const callback = session.questionnaire?.callbackNumber;

  const run = (call: () => Promise<{ ok: boolean; message?: string }>, success: string) =>
    start(async () => {
      const result = await call();
      if (!result.ok) return void toast.error(result.message ?? "Something went wrong.");
      toast.success(success);
      setMode("none");
      setVideo(null);
      router.refresh();
    });

  return (
    <section aria-labelledby="telemedicine-heading" className="flex flex-col gap-3 rounded-lg border border-info/40 bg-info-subtle/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="telemedicine-heading" className="flex items-center gap-1.5 text-table font-semibold">
          <VideoIcon className="size-4" aria-hidden /> Online consultation
        </h3>
        <Badge variant={live ? "info" : session.status === "escalated" ? "warning" : "neutral"}>{sessionLabel(session)}</Badge>
        {callback ? (
          <a href={`tel:${callback.replace(/[^+0-9]/g, "")}`} className="ml-auto inline-flex items-center gap-1 text-meta text-primary hover:underline">
            <PhoneIcon className="size-3.5" aria-hidden /> Callback {callback}
          </a>
        ) : null}
      </div>

      {live && canConduct ? (
        consultation.videoConfigured ? (
          video ? (
            <VideoCall url={video.url} token={video.token} remoteLabel="the patient" onLeave={() => setVideo(null)} className="max-w-2xl" />
          ) : (
            <Button
              size="sm"
              className="self-start"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await joinConsultation(appointment.id);
                  if (result.ok && result.data.video) setVideo(result.data.video);
                  else toast.error(result.ok ? "Video is not available." : result.message);
                })
              }
            >
              <VideoIcon /> Join video
            </Button>
          )
        ) : (
          <p className="text-table">Video is not configured. Call the patient on the callback number and document as usual.</p>
        )
      ) : null}

      <details className="rounded-md border bg-card p-2" open={session.redFlags.length > 0}>
        <summary className="cursor-pointer text-table font-medium">Pre-consult answers{session.redFlags.length ? " · red flags" : ""}</summary>
        <div className="mt-2">
          <QuestionnaireSummary session={session} />
        </div>
      </details>

      {live && canConduct && mode === "none" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setMode("end")}>
            <PhoneOffIcon /> End consultation…
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("escalate")}>
            <HospitalIcon /> Escalate to in-person care…
          </Button>
        </div>
      ) : null}

      {mode !== "none" ? (
        <form
          className="flex flex-col gap-2 rounded-md border bg-card p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "end")
              run(
                () => endConsultation({ appointmentId: appointment.id, patientInstructions: instructions }),
                "Consultation ended — sign the encounter when done",
              );
            else run(() => escalateConsultation({ appointmentId: appointment.id, reason, patientInstructions: instructions }), "Escalated to in-person care");
          }}
        >
          {mode === "escalate" ? (
            <div className="grid gap-1">
              <Label htmlFor="escalate-reason">Why does the patient need in-person care? *</Label>
              <Input id="escalate-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
              <p className="text-meta text-muted-foreground">
                Recorded for the care team; the patient sees only that in-person care is recommended, and your instructions.
              </p>
            </div>
          ) : null}
          <div className="grid gap-1">
            <Label htmlFor="patient-instructions">Instructions for the patient (shown in MyHealth)</Label>
            <Textarea id="patient-instructions" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} />
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant={mode === "escalate" ? "destructive" : "default"}
              disabled={pending || (mode === "escalate" && reason.trim().length < 5)}
            >
              {mode === "end" ? "End consultation" : "Escalate"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("none")}>
              Back
            </Button>
          </div>
        </form>
      ) : null}

      {(session.status === "ended" || session.status === "escalated") && canConduct ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => saveInstructions({ appointmentId: appointment.id, patientInstructions: instructions }),
              "Instructions saved — the patient sees them in MyHealth",
            );
          }}
        >
          {session.status === "escalated" ? (
            <p className="flex items-start gap-1.5 text-table">
              <HospitalIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> Escalated: {session.escalationReason}
            </p>
          ) : null}
          <Label htmlFor="saved-instructions">Instructions for the patient (shown in MyHealth)</Label>
          <Textarea id="saved-instructions" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={pending || !instructions.trim() || instructions === (session.patientInstructions ?? "")}
            >
              Save instructions
            </Button>
            {session.status === "escalated" && bookInPersonHref ? (
              <Button asChild size="sm">
                <Link href={bookInPersonHref}>
                  <CalendarPlusIcon /> Book the in-person visit
                </Link>
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
