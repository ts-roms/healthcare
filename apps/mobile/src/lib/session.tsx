import * as React from "react";
import { createApiClient, type ApiClient, NetworkError } from "./api";
import { nativePush } from "./native-push";
import { unregisterThisPhone } from "./push";
import { secureSessionStore } from "./secure-session-store";
import { settings } from "./settings";
import type { Me } from "./types";

/** `offline`: a session is kept but the clinic could not be reached at start-up. */
type State = { status: "loading" } | { status: "signed_out" } | { status: "offline" } | { status: "signed_in"; me: Me };

interface SessionContext {
  state: State;
  api: ApiClient;
  /** After the API accepted the sign-in: load who the patient is. */
  completeSignIn(): Promise<void>;
  /** Try loading the patient again (after being offline). */
  retry(): void;
  signOut(): Promise<void>;
}

const Context = React.createContext<SessionContext | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<State>({ status: "loading" });
  const api = React.useMemo(
    () =>
      createApiClient({
        baseUrl: settings.apiBaseUrl,
        organizationCode: settings.organizationCode,
        store: secureSessionStore,
        onSignedOut: () => setState({ status: "signed_out" }),
      }),
    [],
  );

  const completeSignIn = React.useCallback(async () => {
    setState({ status: "signed_in", me: await api.get<Me>("/portal/me") });
  }, [api]);

  const start = React.useCallback(async () => {
    setState({ status: "loading" });
    if (!(await api.hasSession())) return setState({ status: "signed_out" });
    try {
      setState({ status: "signed_in", me: await api.get<Me>("/portal/me") });
    } catch (error) {
      // Offline keeps the session; anything else (the server ended it) is handled by the client's sign-out callback.
      setState(error instanceof NetworkError ? { status: "offline" } : { status: "signed_out" });
    }
  }, [api]);

  React.useEffect(() => {
    void start();
  }, [start]);

  const signOut = React.useCallback(async () => {
    await unregisterThisPhone(api, nativePush);
    await api.logout();
    setState({ status: "signed_out" });
  }, [api]);

  const retry = React.useCallback(() => void start(), [start]);
  const value = React.useMemo(() => ({ state, api, completeSignIn, retry, signOut }), [state, api, completeSignIn, retry, signOut]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession(): SessionContext {
  const value = React.useContext(Context);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}
