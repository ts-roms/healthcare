"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { beginSession, endSession, sendHeartbeat } from "@/app/actions";
import { safely } from "@/lib/safe-action";
import { type FlowState, flowReducer, INITIAL_FLOW, isIdleSensitive, type KioskService } from "@/lib/flow";
import { idleState, type IdleState, LOCKED_CLEAR_MS } from "@/lib/idle";
import { BigButton, useCountdown } from "./bits";
import { Frame } from "./frame";
import { AppointmentCheckInPage } from "./pages/appointment-check-in-page";
import { ExistingPatientPage } from "./pages/existing-patient-page";
import { KioskWelcomePage } from "./pages/kiosk-welcome-page";
import { PatientRegistrationPage } from "./pages/patient-registration-page";
import { PatientTypePage } from "./pages/patient-type-page";
import { QueueTicketPage } from "./pages/queue-ticket-page";
import { RegistrationReviewPage } from "./pages/registration-review-page";
import { ServiceSelectionPage } from "./pages/service-selection-page";

export interface KioskAppProps {
  facilityName: string;
  timeZone: string;
  /** The facility's local date (`YYYY-MM-DD`), so a birth date in the future is refused on the screen. */
  today: string;
  deviceStatus: "active" | "maintenance" | "disabled";
  services: KioskService[];
  privacyNotice: string;
  appVersion: string;
}

const HEARTBEAT_MS = 60_000;

/** Nobody can touch the screen for the whole warning without it ending: this only reads the clock, it never extends a session. */
function useIdleWatch(active: boolean, lastTouch: React.RefObject<number>, onExpire: () => void): IdleState {
  const [state, setState] = useState<IdleState>({ kind: "active" });
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const next = idleState(lastTouch.current, Date.now());
      setState(next);
      if (next.kind === "expired") onExpire();
    }, 1000);
    return () => {
      clearInterval(timer);
      setState({ kind: "active" });
    };
  }, [active, lastTouch, onExpire]);
  return active ? state : { kind: "active" };
}

function LockedScreen({ facilityName, onDone }: { facilityName: string; onDone: () => void }) {
  const left = useCountdown(Math.round(LOCKED_CLEAR_MS / 1000), onDone);
  return (
    <Frame title="Please see the front desk" facilityName={facilityName}>
      <p className="text-2xl">We could not check you in here. The front desk will help you.</p>
      <BigButton onClick={onDone} className="self-start">
        OK
      </BigButton>
      <p className="text-lg text-muted-foreground">This screen clears itself in {left} seconds.</p>
    </Frame>
  );
}

/**
 * The whole kiosk flow in one screen, driven by `flowReducer`. What a person types or is told lives in this component's
 * memory only (no storage, no URL, no cookie readable by scripts), and `reset` — a touch on Start over, Done, the idle
 * timeout or any session error — empties it, remounts the forms and ends the session on the server.
 */
export function KioskApp(props: KioskAppProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(flowReducer, INITIAL_FLOW as FlowState);
  const [epoch, setEpoch] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  // Set when a session starts and on every touch; only read while a session is open.
  const lastTouch = useRef(0);

  const reset = useCallback(() => {
    dispatch({ type: "reset" });
    setEpoch((e) => e + 1);
    void endSession();
  }, []);

  // Any touch or key press counts as activity.
  const touch = useCallback(() => {
    lastTouch.current = Date.now();
  }, []);

  const watching = isIdleSensitive(state.step) && state.step !== "ticket" && state.step !== "submitted" && state.step !== "locked";
  const idle = useIdleWatch(watching, lastTouch, reset);

  // Report in, and learn at once when staff put this kiosk into maintenance or switch it off.
  useEffect(() => {
    let failures = 0;
    const beat = async () => {
      const result = await safely(() => sendHeartbeat({ appVersion: props.appVersion }));
      failures = result.ok ? 0 : failures + 1;
      setOnline(failures < 2);
      if (result.ok && result.data.status !== props.deviceStatus) router.refresh();
    };
    void beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [props.appVersion, props.deviceStatus, router]);

  async function start() {
    setStarting(true);
    setStartError(null);
    // A touch is the gesture browsers need before they allow full screen.
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    const result = await safely(beginSession);
    setStarting(false);
    if (!result.ok) return setStartError(result.message);
    lastTouch.current = Date.now();
    dispatch({ type: "start" });
  }

  const outOfService =
    props.deviceStatus === "maintenance"
      ? "This kiosk is out of service. Please check in at the front desk."
      : props.deviceStatus === "disabled"
        ? "This kiosk is switched off. Please check in at the front desk."
        : null;

  const common = { facilityName: props.facilityName, onStartOver: reset };
  const sessionOver = () => {
    dispatch({ type: "locked" });
    setEpoch((e) => e + 1);
  };
  const patient = state.patient;

  let screen: React.ReactNode;
  switch (state.step) {
    case "welcome":
      screen = <KioskWelcomePage facilityName={props.facilityName} outOfService={outOfService} error={startError} starting={starting} onStart={start} />;
      break;
    case "type":
      screen = <PatientTypePage {...common} onChoose={(kind) => dispatch({ type: "choose", kind })} onBack={reset} />;
      break;
    case "existing":
      screen = (
        <ExistingPatientPage
          {...common}
          today={props.today}
          onIdentified={(found) => dispatch({ type: "identified", ...found })}
          onLocked={() => dispatch({ type: "locked" })}
          onBack={() => dispatch({ type: "back" })}
        />
      );
      break;
    case "appointments":
      screen = patient && (
        <AppointmentCheckInPage
          {...common}
          timeZone={props.timeZone}
          patient={patient}
          appointments={state.appointments}
          hasServices={props.services.length > 0}
          onTicket={(ticket) => dispatch({ type: "ticket", ticket })}
          onSessionOver={sessionOver}
          onOtherServices={() => dispatch({ type: "other-services" })}
          onBack={reset}
        />
      );
      break;
    case "services":
      screen = patient && (
        <ServiceSelectionPage
          {...common}
          patient={patient}
          services={props.services}
          onTicket={(ticket) => dispatch({ type: "ticket", ticket })}
          onSessionOver={sessionOver}
          onBack={() => dispatch({ type: "back" })}
        />
      );
      break;
    case "register":
      screen = (
        <PatientRegistrationPage
          key={epoch}
          {...common}
          today={props.today}
          privacyNotice={props.privacyNotice}
          initial={state.form}
          onContinue={(form) => dispatch({ type: "review", form })}
          onBack={() => dispatch({ type: "back" })}
        />
      );
      break;
    case "review":
      screen = state.form && (
        <RegistrationReviewPage
          {...common}
          today={props.today}
          form={state.form as Parameters<typeof RegistrationReviewPage>[0]["form"]}
          onSubmitted={(reference) => dispatch({ type: "submitted", reference })}
          onSessionOver={sessionOver}
          onEdit={() => dispatch({ type: "edit" })}
        />
      );
      break;
    case "ticket":
    case "submitted":
      screen = <QueueTicketPage facilityName={props.facilityName} timeZone={props.timeZone} ticket={state.ticket} reference={state.reference} onDone={reset} />;
      break;
    case "locked":
      screen = <LockedScreen facilityName={props.facilityName} onDone={reset} />;
      break;
  }

  return (
    <div onPointerDownCapture={touch} onKeyDownCapture={touch} onInputCapture={touch} onContextMenu={(e) => e.preventDefault()}>
      {!online && (
        <p role="status" className="bg-warning-subtle px-6 py-2 text-center text-lg text-warning-foreground">
          This kiosk is having trouble connecting. If something does not work, please see the front desk.
        </p>
      )}
      {screen}
      {idle.kind === "warning" && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="idle-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8">
          <div className="flex max-w-xl flex-col items-center gap-6 rounded-3xl bg-card p-10 text-center">
            <h2 id="idle-title" className="text-4xl font-semibold">
              Are you still there?
            </h2>
            <p className="text-2xl">This screen will clear in {idle.secondsLeft} seconds to protect your privacy.</p>
            <BigButton onClick={touch}>I am still here</BigButton>
          </div>
        </div>
      )}
    </div>
  );
}
