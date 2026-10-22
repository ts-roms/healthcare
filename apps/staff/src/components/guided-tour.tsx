"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@healthcare/ui/primitives";
import { TOUR_START_EVENT, WELCOME_TOUR_ID, markTourSeen, resolveTarget, tourForPath, tourToAutoStart, type TourDef } from "@/lib/tour";
import { TOURS } from "@/lib/tour-steps";

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
  const pathname = usePathname();
  const [active, setActive] = React.useState<{ tour: TourDef; index: number } | null>(null);
  const [box, setBox] = React.useState<Box | null>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const tour = active?.tour ?? null;
  const index = active?.index ?? null;
  const step = tour && index !== null ? (tour.steps[index] ?? null) : null;
  const setIndex = React.useCallback((next: number) => setActive((a) => (a ? { ...a, index: Math.min(Math.max(next, 0), a.tour.steps.length - 1) } : a)), []);

  // Start on the first visit to a screen (after it has drawn) — and when someone asks.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      // A page that could not be shown (not found, an error) has nothing to point at.
      if (document.querySelector('[data-slot="error-state"]')) return;
      const next = tourToAutoStart(TOURS, pathname);
      if (next) setActive((current) => current ?? { tour: next, index: 0 });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  React.useEffect(() => {
    const onStart = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string } | undefined>).detail?.id;
      const wanted = id ? TOURS.find((t) => t.id === id) : (tourForPath(TOURS, window.location.pathname) ?? TOURS.find((t) => t.id === WELCOME_TOUR_ID));
      if (wanted) setActive({ tour: wanted, index: 0 });
    };
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => {
      window.removeEventListener(TOUR_START_EVENT, onStart);
    };
  }, []);

  const finish = React.useCallback(() => {
    setActive((a) => {
      if (a) markTourSeen(a.tour);
      return null;
    });
  }, []);

  // Follow the target through scrolling and resizing.
  React.useEffect(() => {
    if (!step) return;
    let scrolled = false;
    const place = () => {
      const found = resolveTarget(step);
      if (found && !scrolled) {
        scrolled = true;
        found.el.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      if (!found) return setBox((current) => (current === null ? current : null));
      const r = found.rect;
      const next = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
      setBox((c) => (c && c.top === next.top && c.left === next.left && c.width === next.width && c.height === next.height ? c : next));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    // A page may still be loading (skeleton) or move things (animation, a panel opening): follow the target until the step ends.
    const timer = window.setInterval(place, 250);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.clearInterval(timer);
    };
  }, [step]);

  React.useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setActive((a) => (a ? { ...a, index: Math.min(a.index + 1, a.tour.steps.length - 1) } : a));
      if (e.key === "ArrowLeft") setActive((a) => (a ? { ...a, index: Math.max(a.index - 1, 0) } : a));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, finish]);

  React.useEffect(() => {
    if (index !== null) cardRef.current?.focus();
  }, [index]);

  if (index === null || !step || !tour) return null;
  const last = index === tour.steps.length - 1;

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
          {tour.title} · step {index + 1} of {tour.steps.length}
        </p>
        <h2 id="tour-title" className="mt-1 text-section font-semibold">
          {step.title}
        </h2>
        <p id="tour-body" className="mt-2 text-body text-muted-foreground">
          {step.body}
        </p>
        {step.link ? (
          <Button asChild variant="link" size="sm" className="mt-1 h-auto px-0">
            <Link href={step.link.href} onClick={finish}>
              {step.link.label}
            </Link>
          </Button>
        ) : null}
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
