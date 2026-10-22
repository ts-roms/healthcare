"use client";

import * as React from "react";
import { Button } from "@healthcare/ui/primitives";
import { TOUR_START_EVENT, TOUR_STEPS, isTourEnabled, markTourSeen, resolveTarget, shouldAutoStart, TOUR_CHANGE_EVENT } from "@/lib/tour";

const PAD = 6;
const CARD_WIDTH = 340;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The guided tour: a dimmed screen with the current area highlighted and a card that explains it. Starts by itself the first
 * time a browser opens the app while the Settings switch is on, and on request from Settings. Escape or Skip ends it.
 * Rendered by `StaffShell`, so the signed-out pages and the waiting-room display never show it.
 */
export function GuidedTour() {
  const [index, setIndex] = React.useState<number | null>(null);
  const [box, setBox] = React.useState<Box | null>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const step = index === null ? null : TOUR_STEPS[index];

  // Start on the first visit (after the page has drawn its navigation) or when Settings asks.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      if (shouldAutoStart()) setIndex(0);
    }, 800);
    const onStart = () => setIndex(0);
    const onChange = () => {
      if (!isTourEnabled()) setIndex(null);
    };
    window.addEventListener(TOUR_START_EVENT, onStart);
    window.addEventListener(TOUR_CHANGE_EVENT, onChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(TOUR_START_EVENT, onStart);
      window.removeEventListener(TOUR_CHANGE_EVENT, onChange);
    };
  }, []);

  const finish = React.useCallback(() => {
    markTourSeen();
    setIndex(null);
  }, []);

  // Follow the target through scrolling and resizing.
  React.useEffect(() => {
    if (!step) return;
    const place = () => {
      const el = resolveTarget(step);
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    };
    resolveTarget(step)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [step]);

  React.useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setIndex((i) => (i === null ? i : Math.min(i + 1, TOUR_STEPS.length - 1)));
      if (e.key === "ArrowLeft") setIndex((i) => (i === null ? i : Math.max(i - 1, 0)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, finish]);

  React.useEffect(() => {
    if (index !== null) cardRef.current?.focus();
  }, [index]);

  if (index === null || !step) return null;
  const last = index === TOUR_STEPS.length - 1;

  const margin = 12;
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const width = Math.min(CARD_WIDTH, vw - margin * 2);
  let cardStyle: React.CSSProperties;
  if (box) {
    const below = box.top + box.height + margin + 200 < vh;
    const top = below ? box.top + box.height + margin : Math.max(margin, box.top - margin - 200);
    const left = Math.min(Math.max(margin, box.left), vw - width - margin);
    cardStyle = { top, left, width };
  } else {
    cardStyle = { top: "50%", left: "50%", width, transform: "translate(-50%, -50%)" };
  }

  return (
    <div className="fixed inset-0 z-[60]" role="presentation">
      {/* The dimmed screen: a box-shadow around the highlight, or a plain veil when the step has no target. */}
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{ ...box, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)" }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/55" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="fixed rounded-lg border bg-card p-4 text-card-foreground shadow-lg outline-none"
        style={cardStyle}
      >
        <p className="text-meta text-muted-foreground">
          Step {index + 1} of {TOUR_STEPS.length}
        </p>
        <h2 id="tour-title" className="mt-1 text-section font-semibold">
          {step.title}
        </h2>
        <p id="tour-body" className="mt-2 text-body text-muted-foreground">
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip tour
          </Button>
          <div className="flex gap-2">
            {index > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setIndex(index - 1)}>
                Back
              </Button>
            ) : null}
            <Button size="sm" onClick={() => (last ? finish() : setIndex(index + 1))}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
