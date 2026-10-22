"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClockIcon, CameraIcon, CircleAlertIcon, KeyboardIcon, ScanLineIcon, ScanQrCodeIcon, TicketIcon, UserRoundSearchIcon } from "lucide-react";
import { cn } from "@healthcare/ui/lib/utils";
import { Avatar, AvatarFallback, Badge, Button, Card, CardContent, Input, Skeleton, ToggleGroup, ToggleGroupItem } from "@healthcare/ui/primitives";
import { clinicalDate, clinicalDateTime, sexLabel } from "@healthcare/ui/healthcare";
import type { PatientSummary } from "@/lib/api/types";
import { scanDetails, scanPatientQr, type ScanDetails } from "./actions";

/** The browser's barcode reader, where it has one (Chromium-based browsers); the text field also takes a hand-held scanner. */
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

type Mode = "scanner" | "camera";

/** The way a browser last scanned is remembered (a front desk with a hand-held scanner should not switch every time); the camera is the default. */
const MODE_KEY = "hp.scan.mode";
const MODE_EVENT = "hp:scan-mode";
const readMode = (): Mode => {
  try {
    return window.localStorage.getItem(MODE_KEY) === "scanner" ? "scanner" : "camera";
  } catch {
    return "camera";
  }
};
const subscribeMode = (onChange: () => void) => {
  window.addEventListener(MODE_EVENT, onChange);
  return () => window.removeEventListener(MODE_EVENT, onChange);
};
const storeMode = (mode: Mode) => {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Not remembered (private window); the camera is the default next time.
  }
  window.dispatchEvent(new Event(MODE_EVENT));
};

const PRIORITY: Record<"routine" | "urgent" | "emergency", { label: string; variant: "neutral" | "warning" | "danger" }> = {
  routine: { label: "Routine priority", variant: "neutral" },
  urgent: { label: "Urgent priority", variant: "warning" },
  emergency: { label: "Emergency priority", variant: "danger" },
};

const APPOINTMENT_STATUS: Record<string, string> = {
  booked: "Booked",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  completed: "Completed",
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/**
 * Finds a patient from their QR code, two ways: a hand-held scanner (it types the code and presses Enter, so the field
 * must have focus) or the device camera. The result — the minimal summary the API returns — appears beside the scan
 * panel with what to do next. Every scan is audited by the API (never the code itself).
 */
export function ScanQr({ canOpenRecord, canCheckIn }: { canOpenRecord: boolean; canCheckIn: boolean }) {
  const preferred = React.useSyncExternalStore(subscribeMode, readMode, () => "camera" as Mode);
  // The camera is paused while a result is shown (and after it failed), without forgetting the preferred way.
  const [paused, setPaused] = React.useState(false);
  const [details, setDetails] = React.useState<ScanDetails | null>(null);
  const [detailsPending, setDetailsPending] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [patient, setPatient] = React.useState<PatientSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [focused, setFocused] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // The camera works wherever the browser lets the page open it (HTTPS or localhost); QR reading is the browser's own
  // reader when it has one, otherwise a small decoder run on each frame.
  const cameraSupported = React.useSyncExternalStore(
    () => () => undefined,
    () => typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function",
    () => false,
  );
  const camera = preferred === "camera" && cameraSupported && !paused;
  const choose = (next: Mode) => {
    setPaused(false);
    setError(null);
    storeMode(next);
  };

  const resolve = React.useCallback((payload: string) => {
    setError(null);
    startTransition(async () => {
      const result = await scanPatientQr(payload);
      if (result.ok) {
        setPatient(result.data.patient);
        setValue("");
        setDetails(null);
        setDetailsPending(true);
        void scanDetails(result.data.patient.id)
          .then(setDetails)
          .catch(() => setDetails(null))
          .finally(() => setDetailsPending(false));
      } else {
        setPatient(null);
        setError(result.message);
      }
    });
  }, []);

  // Ready for the next card: the camera again, or the field (kept focused) for a hand-held scanner.
  const scanAgain = () => {
    setPatient(null);
    setDetails(null);
    setError(null);
    setPaused(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  React.useEffect(() => {
    if (!camera) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    const Native = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    const native = Native ? new Native({ formats: ["qr_code"] }) : null;
    const canvas = document.createElement("canvas");
    /** The text of a QR code in the current frame, or null. */
    const readFrame = async (video: HTMLVideoElement): Promise<string | null> => {
      if (native) return (await native.detect(video).catch(() => []))[0]?.rawValue ?? null;
      if (video.videoWidth === 0) return null;
      // Scaled down: reading is faster and a card held at arm's length is still large enough.
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { default: jsQR } = await import("jsqr");
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data ?? null;
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();
        while (!stopped) {
          const first = await readFrame(video);
          if (first) {
            setPaused(true);
            resolve(first);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setPaused(true);
        setError("The camera could not be used. Allow camera access, or scan or type the code into the field.");
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, resolve]);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section aria-label="Scan" className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs">
        <ToggleGroup
          type="single"
          value={camera ? "camera" : "scanner"}
          onValueChange={(next) => next && choose(next as Mode)}
          aria-label="How to scan"
          className="self-start"
        >
          <ToggleGroupItem value="scanner">
            <KeyboardIcon /> Hand-held scanner
          </ToggleGroupItem>
          <ToggleGroupItem value="camera" disabled={!cameraSupported}>
            <CameraIcon /> Camera
          </ToggleGroupItem>
        </ToggleGroup>
        {!cameraSupported ? (
          <p className="text-meta text-muted-foreground">
            The camera is not available here: this page must be opened over HTTPS (or on localhost) and the browser must allow the camera. Use a hand-held
            scanner, or search for the patient by number.
          </p>
        ) : null}

        {camera ? (
          <div className="flex flex-col gap-3">
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-black">
              <video ref={videoRef} muted playsInline className="size-full object-cover" aria-label="Camera" />
              <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
                <div className="relative size-1/2 min-w-40">
                  <span className="absolute top-0 left-0 size-8 rounded-tl-xl border-t-4 border-l-4 border-white" />
                  <span className="absolute top-0 right-0 size-8 rounded-tr-xl border-t-4 border-r-4 border-white" />
                  <span className="absolute bottom-0 left-0 size-8 rounded-bl-xl border-b-4 border-l-4 border-white" />
                  <span className="absolute right-0 bottom-0 size-8 rounded-br-xl border-r-4 border-b-4 border-white" />
                </div>
              </div>
            </div>
            <p className="text-table text-muted-foreground" role="status">
              Hold the patient&apos;s card in front of the camera. It reads the code by itself.
            </p>
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => choose("scanner")}>
              Stop camera
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) resolve(value);
            }}
          >
            <button
              type="button"
              onClick={() => inputRef.current?.focus()}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                focused ? "border-primary bg-primary-subtle/60" : "border-border bg-muted/30 hover:border-primary/50",
              )}
            >
              <span className={cn("grid size-16 place-items-center rounded-2xl bg-card text-primary shadow-xs", focused && "motion-safe:animate-pulse")}>
                <ScanQrCodeIcon className="size-8" aria-hidden />
              </span>
              <span className="text-section font-semibold">{focused ? "Ready. Scan the patient's card" : "Click here to start scanning"}</span>
              <span className="max-w-sm text-table text-muted-foreground">
                {focused
                  ? "Point the hand-held scanner at the QR code. The result appears on the right."
                  : "The scanner types into the field below, so it must have focus."}
              </span>
            </button>
            <div className="grid gap-1.5">
              <label htmlFor="qr-scan-field" className="text-table font-medium">
                Or paste or type the code
              </label>
              <div className="flex gap-2">
                <Input
                  ref={inputRef}
                  id="qr-scan-field"
                  value={value}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onChange={(e) => setValue(e.target.value)}
                />
                <Button type="submit" disabled={pending || !value.trim()}>
                  <ScanLineIcon /> Find
                </Button>
              </div>
            </div>
          </form>
        )}
      </section>

      <section aria-label="Result" aria-live="polite" className="flex flex-col gap-4">
        {pending ? (
          <Card role="status" aria-busy="true">
            <CardContent className="flex items-center gap-4">
              <Skeleton className="size-14 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3.5 w-64 max-w-full" />
              </div>
              <span className="sr-only">Looking up the patient…</span>
            </CardContent>
          </Card>
        ) : error ? (
          <Card role="alert" className="border-danger/40">
            <CardContent className="flex flex-col items-start gap-3">
              <p className="flex items-center gap-2 text-section font-semibold text-danger-foreground">
                <CircleAlertIcon className="size-5" aria-hidden /> Could not find that patient
              </p>
              <p className="text-body text-muted-foreground">{error}</p>
              <Button size="sm" variant="outline" onClick={scanAgain}>
                <ScanLineIcon /> Scan again
              </Button>
            </CardContent>
          </Card>
        ) : patient ? (
          <Card className="animate-in duration-300 fade-in slide-in-from-bottom-1">
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <Avatar className="size-14 text-section-lg">
                  <AvatarFallback className="bg-primary-subtle text-primary-deep">{initialsOf(patient.displayName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-section-lg font-semibold">{patient.displayName}</p>
                  <p className="text-table text-muted-foreground">
                    <span className="font-mono">{patient.patientNumber}</span> · {sexLabel(patient.sex)} · {patient.age} y · born{" "}
                    {clinicalDate(patient.birthDate)}
                  </p>
                </div>
                {patient.status !== "active" ? (
                  <Badge variant="warning" className="ml-auto shrink-0">
                    {patient.status}
                  </Badge>
                ) : null}
              </div>
              {patient.resolvedFrom ? (
                <p className="rounded-md bg-muted/60 px-3 py-2 text-table text-muted-foreground">
                  The card belongs to {patient.resolvedFrom.patientNumber}, now merged into this record.
                </p>
              ) : null}
              <VisitDetails details={details} pending={detailsPending} />
              <div className="flex flex-wrap gap-2">
                {canOpenRecord ? (
                  <Button asChild>
                    <Link href={`/patients/${patient.id}`}>Open record</Link>
                  </Button>
                ) : null}
                {canCheckIn && patient.status === "active" ? (
                  details?.visit?.open ? (
                    <Button asChild variant="outline">
                      <Link href="/queue">View in queue</Link>
                    </Button>
                  ) : (
                    <>
                      {details?.appointment && ["booked", "confirmed"].includes(details.appointment.status) ? (
                        <Button asChild variant="outline">
                          <Link href="/appointments">Check in appointment</Link>
                        </Button>
                      ) : null}
                      <Button asChild variant="outline" disabled={detailsPending}>
                        <Link href={`/queue/walk-in?patientId=${patient.id}`} aria-disabled={detailsPending}>
                          {details?.appointment ? "Check in as walk-in" : "Check in"}
                        </Link>
                      </Button>
                    </>
                  )
                ) : null}
                <Button variant="ghost" onClick={scanAgain}>
                  <ScanLineIcon /> Scan next
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center text-muted-foreground">
            <UserRoundSearchIcon className="size-10" aria-hidden />
            <p className="text-section font-semibold text-foreground">No patient scanned yet</p>
            <p className="max-w-xs text-table">The patient&apos;s name and what you can do next appear here after a scan. Every scan is recorded.</p>
          </div>
        )}
      </section>
    </div>
  );
}

/** Today's queue ticket and appointment of the scanned patient, so the desk sees at once whether they are already checked in and how urgent it is. */
function VisitDetails({ details, pending }: { details: ScanDetails | null; pending: boolean }) {
  if (pending) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-busy="true">
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-4 w-40" />
        <span className="sr-only">Looking up today&apos;s visit…</span>
      </div>
    );
  }
  const visit = details?.visit ?? null;
  const appointment = details?.appointment ?? null;
  if (!visit && !appointment) return null;
  return (
    <dl className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 text-table">
      {visit ? (
        <div className="flex flex-col gap-1.5">
          <dt className="flex items-center gap-1.5 font-medium">
            <TicketIcon className="size-4 text-muted-foreground" aria-hidden /> {visit.open ? "In the queue today" : "Visit today"}
          </dt>
          <dd className="flex flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-mono">
                {visit.ticket}
              </Badge>
              <Badge variant={PRIORITY[visit.priority].variant}>{PRIORITY[visit.priority].label}</Badge>
              <Badge variant="info">{visit.statusLabel}</Badge>
              <Badge variant="neutral">{visit.arrivalMode === "appointment" ? "With appointment" : "Walk-in"}</Badge>
              {visit.checkedInOnline ? <Badge variant="teal">Checked in online</Badge> : null}
            </span>
            <span className="text-muted-foreground">
              Checked in {clinicalDateTime(visit.checkedInAt)}
              {visit.open ? ` · waiting ${visit.waitingMinutes} min` : ""}
              {visit.servicePointName ? ` · ${visit.servicePointName}` : ""}
              {visit.calledTo ? ` · called to ${visit.calledTo}` : ""}
            </span>
            {visit.chiefComplaint ? <span>Reason: {visit.chiefComplaint}</span> : null}
          </dd>
        </div>
      ) : null}
      {appointment ? (
        <div className="flex flex-col gap-1.5">
          <dt className="flex items-center gap-1.5 font-medium">
            <CalendarClockIcon className="size-4 text-muted-foreground" aria-hidden /> Appointment today
          </dt>
          <dd className="flex flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{clinicalDateTime(appointment.startsAt)}</Badge>
              {appointment.visitTypeName ? <Badge variant="neutral">{appointment.visitTypeName}</Badge> : null}
              {appointment.mode === "telemedicine" ? <Badge variant="teal">Online</Badge> : null}
              <Badge variant="info">{APPOINTMENT_STATUS[appointment.status] ?? appointment.status}</Badge>
            </span>
            {appointment.practitionerName ? <span className="text-muted-foreground">With {appointment.practitionerName}</span> : null}
            {appointment.reason ? <span>Reason: {appointment.reason}</span> : null}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
