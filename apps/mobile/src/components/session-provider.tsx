import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { patientMessage } from "@/lib/api-error";
import type { PortalMe } from "@/lib/api-types";
import { nativePush } from "@/lib/native-push";
import { unregisterThisPhone } from "@/lib/push";
import { session } from "@/lib/session-instance";

type AppSession =
  | { status: "starting" }
  | { status: "signed_out"; notice: string | null }
  | { status: "signed_in"; me: PortalMe }
  /** A stored session could not be checked (e.g. offline) or the profile did not load. */
  | { status: "unavailable"; message: string };

interface SessionContextValue {
  state: AppSession;
  retry: () => void;
  /** After the sign-in screen opened a session: loads the profile. */
  signedIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppSession>({ status: "starting" });

  const loadMe = useCallback(async () => {
    try {
      setState({ status: "signed_in", me: await session.get<PortalMe>("/portal/me") });
    } catch (error) {
      if (!session.signedIn) return; // the session ended; the listener below shows sign-in
      setState({ status: "unavailable", message: patientMessage(error) });
    }
  }, []);

  const start = useCallback(async () => {
    setState({ status: "starting" });
    try {
      if (await session.restore()) await loadMe();
      else setState({ status: "signed_out", notice: null });
    } catch (error) {
      setState({ status: "unavailable", message: patientMessage(error) });
    }
  }, [loadMe]);

  useEffect(() => {
    void start();
    return session.subscribe((change) => {
      if (change.status === "signed_out") {
        setState({ status: "signed_out", notice: change.reason === "session_ended" ? "Your session has ended. Sign in again." : null });
      }
    });
  }, [start]);

  const value: SessionContextValue = {
    state,
    retry: () => void (session.signedIn ? loadMe() : start()),
    signedIn: loadMe,
    // This phone stops receiving the patient's notifications before the session ends (best effort; never blocks sign-out).
    signOut: async () => {
      await unregisterThisPhone(session, nativePush);
      await session.signOut();
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}
