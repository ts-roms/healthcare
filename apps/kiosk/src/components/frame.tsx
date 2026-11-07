"use client";

import { ChevronLeftIcon, XIcon } from "lucide-react";
import { BigButton } from "./bits";

/**
 * The frame every step sits in: where you are, a way back and a way out. "Start over" is always on screen because the
 * next person must be able to clear what the last one typed with one touch.
 */
export function Frame({
  title,
  facilityName,
  onBack,
  onStartOver,
  children,
}: {
  title: string;
  facilityName: string;
  onBack?: () => void;
  onStartOver?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-8 py-4">
        <p className="text-xl font-semibold text-primary-deep">{facilityName}</p>
        {onStartOver && (
          <BigButton variant="outline" onClick={onStartOver} className="min-h-14 px-6 text-xl">
            <XIcon aria-hidden /> Start over
          </BigButton>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-8 py-8">
        <div className="flex items-center gap-4">
          {onBack && (
            <BigButton variant="secondary" onClick={onBack} aria-label="Go back" className="min-h-14 px-5">
              <ChevronLeftIcon aria-hidden className="size-7" />
            </BigButton>
          )}
          <h1 className="text-4xl leading-tight font-semibold">{title}</h1>
        </div>
        {children}
      </main>
    </div>
  );
}

/** A message in large type. Errors are announced at once; the rest politely. */
export function Notice({ tone, children }: { tone: "error" | "info" | "success"; children: React.ReactNode }) {
  const style =
    tone === "error"
      ? "border-danger/40 bg-danger-subtle text-danger-foreground"
      : tone === "success"
        ? "border-success/40 bg-success-subtle text-success-foreground"
        : "border-info/30 bg-info-subtle text-info-foreground";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-2xl border px-6 py-4 text-xl ${style}`}>
      {children}
    </p>
  );
}
