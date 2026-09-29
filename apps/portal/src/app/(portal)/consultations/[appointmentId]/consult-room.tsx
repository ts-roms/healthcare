"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertOctagonIcon, CheckCircle2Icon, ClockIcon, HospitalIcon, LoaderIcon, PhoneIcon, VideoIcon } from "lucide-react";
import { VideoCall } from "@healthcare/ui/healthcare";
import { Button, Checkbox, Input, Label, Textarea } from "@healthcare/ui/primitives";
import type { PortalTeleconsult, VideoJoin } from "@/lib/api/types";
import { visitTime } from "@/lib/records";
import { BLANK_QUESTIONNAIRE, consultStage, type QuestionnaireForm, RED_FLAGS } from "@/lib/teleconsult";
import { enterWaitingRoom, joinVideo, submitQuestionnaire } from "../actions";

const POLL_MS = 5_000;

/** One online consultation, step by step: questions → waiting room → video → instructions. */
export function ConsultRoom({ consult }: { consult: PortalTeleconsult }) {
  const router = useRouter();
  const [now, setNow] = React.useState(() => new Date());
  const stage = consultStage(consult, now);

  // While waiting (or before the room opens) re-read the consultation: the doctor may start at any moment.
  React.useEffect(() => {
    if (!["waiting", "early", "ready"].includes(stage)) return;
    const timer = window.setInterval(() => {
      setNow(new Date());
      if (stage === "waiting") router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [stage, router]);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-page-lg font-semibold">Online consultation</h1>
        <p className="text-body text-muted-foreground">
          {consult.practitionerName} · {visitTime({ startsAt: consult.startsAt, timeZone: consult.timeZone })}
        </p>
      </header>
      {stage === "questionnaire" ? <Questionnaire appointmentId={consult.appointmentId} onDone={() => router.refresh()} /> : null}
      {stage === "early" ? (
        <Panel icon={ClockIcon} title="Your answers are with your doctor">
          The waiting room opens at {visitTime({ startsAt: consult.waitingRoomOpensAt, timeZone: consult.timeZone })}. Keep this page open or come back then.
        </Panel>
      ) : null}
      {stage === "ready" ? <EnterWaitingRoom appointmentId={consult.appointmentId} onDone={() => router.refresh()} /> : null}
      {stage === "waiting" ? (
        <Panel icon={LoaderIcon} title="You are in the waiting room" spin>
          {consult.practitionerName} will start the consultation shortly. Keep this page open; it updates by itself. If the video does not work, your doctor
          will call the number you gave.
        </Panel>
      ) : null}
      {stage === "in_call" ? <InCall consult={consult} /> : null}
      {stage === "ended" ? (
        <Panel icon={CheckCircle2Icon} title="Your consultation has ended">
          <Instructions text={consult.patientInstructions} />
        </Panel>
      ) : null}
      {stage === "escalated" ? (
        <Panel icon={HospitalIcon} title="Your doctor recommends seeing you in person" tone="attention">
          Some things cannot be checked online. Please follow your doctor&apos;s instructions and visit the clinic.
          <Instructions text={consult.patientInstructions} />
        </Panel>
      ) : null}
      {stage === "closed" ? (
        <Panel icon={ClockIcon} title="This consultation is no longer available">
          To book another consultation, contact the clinic.
        </Panel>
      ) : null}
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  children,
  tone = "default",
  spin,
}: {
  icon: typeof ClockIcon;
  title: string;
  children: React.ReactNode;
  tone?: "default" | "attention";
  spin?: boolean;
}) {
  return (
    <section className={`flex gap-3 rounded-xl border p-4 ${tone === "attention" ? "border-warning/40 bg-warning-subtle" : "bg-card"}`}>
      <Icon className={`mt-0.5 size-6 shrink-0 ${spin ? "animate-spin" : ""}`} aria-hidden />
      <div className="flex flex-col gap-2">
        <h2 className="text-section-lg font-semibold">{title}</h2>
        <div className="flex flex-col gap-2 text-body">{children}</div>
      </div>
    </section>
  );
}

function Instructions({ text }: { text: string | null }) {
  if (!text) return <p className="text-muted-foreground">Your doctor has not added written instructions.</p>;
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-meta font-semibold text-muted-foreground uppercase">Your doctor&apos;s instructions</p>
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}

function Questionnaire({ appointmentId, onDone }: { appointmentId: string; onDone: () => void }) {
  const [form, setForm] = React.useState<QuestionnaireForm>(BLANK_QUESTIONNAIRE);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const emergency = form.redFlags.length > 0;
  const set = <K extends keyof QuestionnaireForm>(key: K, value: QuestionnaireForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const result = await submitQuestionnaire(appointmentId, form);
      if (result.ok) return onDone();
      setMessage(result.message);
      setErrors(result.fields ?? {});
    });
  };

  const field = (key: "reasonForVisit" | "symptoms" | "currentMedications" | "newAllergies", label: string, hint?: string, multiline = true) => (
    <div className="grid gap-1.5">
      <Label htmlFor={key}>{label}</Label>
      {hint ? <p className="text-meta text-muted-foreground">{hint}</p> : null}
      {multiline ? (
        <Textarea id={key} rows={3} value={form[key]} onChange={(e) => set(key, e.target.value)} aria-invalid={!!errors[key]} />
      ) : (
        <Input id={key} value={form[key]} onChange={(e) => set(key, e.target.value)} aria-invalid={!!errors[key]} />
      )}
      {errors[key] ? <p className="text-meta text-danger-foreground">{errors[key]}</p> : null}
    </div>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border bg-card p-4" noValidate>
      <div>
        <h2 className="text-section-lg font-semibold">Before your consultation</h2>
        <p className="text-body text-muted-foreground">Your doctor reads your answers before the call. Answer in your own words.</p>
      </div>
      {field("reasonForVisit", "Why are you consulting? *")}
      {field("symptoms", "What symptoms do you have?")}
      <div className="grid gap-1.5">
        <Label htmlFor="symptomDurationDays">For how many days?</Label>
        <Input
          id="symptomDurationDays"
          inputMode="numeric"
          className="w-28"
          value={form.symptomDurationDays}
          onChange={(e) => set("symptomDurationDays", e.target.value)}
        />
      </div>
      {field("currentMedications", "Medicines you are taking now", "Include vitamins and herbal products.")}
      {field("newAllergies", "Any new allergies since your last visit?", undefined, false)}

      <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
        <legend className="px-1 font-semibold">Do you have any of these right now?</legend>
        {RED_FLAGS.map((flag) => (
          <label key={flag.key} className="flex items-start gap-2 text-body">
            <Checkbox
              className="mt-0.5"
              checked={form.redFlags.includes(flag.key)}
              onCheckedChange={(c) => set("redFlags", c ? [...form.redFlags, flag.key] : form.redFlags.filter((k) => k !== flag.key))}
            />
            {flag.label}
          </label>
        ))}
      </fieldset>
      {emergency ? (
        <div role="alert" className="flex gap-3 rounded-xl border-2 border-danger bg-danger-subtle p-4 text-danger-foreground">
          <AlertOctagonIcon className="mt-0.5 size-6 shrink-0" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">This may be an emergency. Do not wait for an online consultation.</p>
            <p>
              Call{" "}
              <a href="tel:911" className="font-semibold underline">
                911
              </a>{" "}
              or go to the nearest emergency room now. You can still send your answers so your doctor knows.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor="locationCity">Where will you be during the call? (city or municipality) *</Label>
        <Input id="locationCity" value={form.locationCity} onChange={(e) => set("locationCity", e.target.value)} aria-invalid={!!errors.locationCity} />
        {errors.locationCity ? <p className="text-meta text-danger-foreground">{errors.locationCity}</p> : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="callbackNumber">A number we can call if the video fails *</Label>
        <Input
          id="callbackNumber"
          type="tel"
          inputMode="tel"
          value={form.callbackNumber}
          onChange={(e) => set("callbackNumber", e.target.value)}
          aria-invalid={!!errors.callbackNumber}
        />
        {errors.callbackNumber ? <p className="text-meta text-danger-foreground">{errors.callbackNumber}</p> : null}
      </div>

      <label className="flex items-start gap-2 rounded-lg bg-muted p-3 text-body">
        <Checkbox className="mt-0.5" checked={form.acknowledgesOnlineConsultation} onCheckedChange={(c) => set("acknowledgesOnlineConsultation", c === true)} />
        <span>
          I understand that an online consultation cannot include a physical examination, that my doctor may ask me to come to the clinic, and that I should use
          a private place for the call. The call is not recorded.
        </span>
      </label>
      {message ? (
        <p role="alert" className="text-body text-danger-foreground">
          {message}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending || !form.acknowledgesOnlineConsultation}>
        Send my answers
      </Button>
    </form>
  );
}

function EnterWaitingRoom({ appointmentId, onDone }: { appointmentId: string; onDone: () => void }) {
  const [pending, start] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);
  return (
    <Panel icon={VideoIcon} title="Ready when you are">
      Find a quiet, private place with good signal. When you enter the waiting room, the clinic knows you are here.
      {message ? (
        <p role="alert" className="text-danger-foreground">
          {message}
        </p>
      ) : null}
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await enterWaitingRoom(appointmentId);
            if (result.ok) onDone();
            else setMessage(result.message);
          })
        }
      >
        Enter the waiting room
      </Button>
    </Panel>
  );
}

function InCall({ consult }: { consult: PortalTeleconsult }) {
  const router = useRouter();
  const [video, setVideo] = React.useState<VideoJoin | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  if (!consult.videoConfigured) {
    return (
      <Panel icon={PhoneIcon} title="Your doctor will call you">
        Video is not available right now. {consult.practitionerName} will call the number you gave. Keep your phone nearby.
      </Panel>
    );
  }
  if (video) return <VideoCall url={video.url} token={video.token} remoteLabel="your doctor" onLeave={() => router.refresh()} />;
  return (
    <Panel icon={VideoIcon} title={`${consult.practitionerName} is ready`}>
      Your browser will ask to use your camera and microphone.
      {message ? (
        <p role="alert" className="text-danger-foreground">
          {message}
        </p>
      ) : null}
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await joinVideo(consult.appointmentId);
            if (result.ok) setVideo(result.data);
            else setMessage(result.message);
          })
        }
      >
        <VideoIcon /> Join the video call
      </Button>
    </Panel>
  );
}
