"use client";

import * as React from "react";
import { MonitorSmartphoneIcon, XIcon } from "lucide-react";

const HIDDEN_KEY = "myhealth-kiosk-notice-hidden";

const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener("myhealth-kiosk-notice", notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener("myhealth-kiosk-notice", notify);
  };
};
const readHidden = () => {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
};

const STEPS = [
  "Touch the screen and choose “Yes, I am a patient here”.",
  "Enter your patient number or mobile number, your date of birth and your first name.",
  "Choose your appointment, or the service you came for, and take your queue number.",
];

/**
 * A notice on the home page that the clinic has self-service kiosks: what they are for and how to use one. It is shown only
 * when a kiosk is in service, names places only, and a patient can hide it (kept in this browser). Nothing about the
 * patient is read or sent.
 */
export function KioskPromo({ locations }: { locations: string[] }) {
  const hidden = React.useSyncExternalStore(subscribe, readHidden, () => true);
  if (hidden) return null;
  const hide = () => {
    try {
      window.localStorage.setItem(HIDDEN_KEY, "1");
    } catch {
      // Storage blocked: the notice is hidden until the page is loaded again.
    }
    window.dispatchEvent(new Event("myhealth-kiosk-notice"));
  };
  return (
    <section aria-labelledby="kiosk-promo-title" className="relative overflow-hidden rounded-2xl border border-primary/20 bg-primary-subtle p-4 pr-12">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <MonitorSmartphoneIcon className="size-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-meta font-semibold tracking-wide text-primary uppercase">New at the clinic</p>
          <h2 id="kiosk-promo-title" className="text-section-lg font-semibold">
            Skip the front desk line
          </h2>
          <p className="mt-0.5 text-body text-muted-foreground">
            When you arrive, check in yourself at the self-service kiosk and take your queue number
            {locations.length > 0 ? <> at {locations.join(" or ")}</> : null}.
          </p>
        </div>
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step} className="flex items-start gap-2 rounded-xl bg-card/80 p-2.5 text-body">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-meta font-semibold text-primary-foreground">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-meta text-muted-foreground">New to the clinic, or not sure? The front desk is always glad to help. Not for emergencies.</p>
      <button
        type="button"
        onClick={hide}
        aria-label="Hide this notice"
        className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <XIcon className="size-4" aria-hidden />
      </button>
    </section>
  );
}
