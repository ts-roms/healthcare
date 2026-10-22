"use client";

import * as React from "react";
import Link from "next/link";
import { CameraIcon, ScanLineIcon } from "lucide-react";
import { Badge, Button, Card, CardContent, Input, Label } from "@healthcare/ui/primitives";
import { clinicalDate, sexLabel } from "@healthcare/ui/healthcare";
import type { PatientSummary } from "@/lib/api/types";
import { scanPatientQr } from "./actions";

/** The browser's barcode reader, where it has one (Chromium-based browsers); the text field also takes a hand-held scanner. */
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

export function ScanQr({ canOpenRecord, canCheckIn }: { canOpenRecord: boolean; canCheckIn: boolean }) {
  const [value, setValue] = React.useState("");
  const [patient, setPatient] = React.useState<PatientSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [camera, setCamera] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const detectorSupported = typeof window !== "undefined" && "BarcodeDetector" in window;

  const resolve = React.useCallback((payload: string) => {
    setError(null);
    startTransition(async () => {
      const result = await scanPatientQr(payload);
      if (result.ok) {
        setPatient(result.data.patient);
        setValue("");
      } else {
        setPatient(null);
        setError(result.message);
      }
    });
  }, []);

  React.useEffect(() => {
    if (!camera) return;
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    const detector = new Detector({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();
        while (!stopped) {
          const found = await detector.detect(video).catch(() => []);
          const first = found[0]?.rawValue;
          if (first) {
            setCamera(false);
            resolve(first);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setCamera(false);
        setError("The camera could not be used. Allow camera access, or type or scan the code into the field.");
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, resolve]);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) resolve(value);
        }}
      >
        <Label htmlFor="qr-scan-field">Scan with a hand-held scanner, or paste the code</Label>
        <div className="flex gap-2">
          <Input id="qr-scan-field" value={value} autoFocus autoComplete="off" spellCheck={false} onChange={(e) => setValue(e.target.value)} />
          <Button type="submit" disabled={pending || !value.trim()}>
            <ScanLineIcon /> Find
          </Button>
        </div>
        {detectorSupported ? (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setCamera((c) => !c)}>
            <CameraIcon /> {camera ? "Stop camera" : "Use the camera"}
          </Button>
        ) : (
          <p className="text-meta text-muted-foreground">
            This browser cannot read QR codes with the camera. Use a hand-held scanner, or search for the patient by number.
          </p>
        )}
      </form>
      {camera ? <video ref={videoRef} muted playsInline className="aspect-video w-full max-w-md rounded-md border bg-black" aria-label="Camera" /> : null}
      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-table text-danger-foreground">
          {error}
        </p>
      ) : null}
      {patient ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div>
              <p className="text-section font-semibold">{patient.displayName}</p>
              <p className="text-table text-muted-foreground">
                {patient.patientNumber} · {sexLabel(patient.sex)} · {patient.age} y · born {clinicalDate(patient.birthDate)}
              </p>
              {patient.status !== "active" ? <Badge variant="warning">{patient.status}</Badge> : null}
              {patient.resolvedFrom ? (
                <p className="text-meta text-muted-foreground">The card belongs to {patient.resolvedFrom.patientNumber}, now merged into this record.</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {canOpenRecord ? (
                <Button asChild size="sm">
                  <Link href={`/patients/${patient.id}`}>Open record</Link>
                </Button>
              ) : null}
              {canCheckIn && patient.status === "active" ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/queue/walk-in?patientId=${patient.id}`}>Check in</Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
