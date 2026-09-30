import { useCallback, useEffect, useState } from "react";
import { patientMessage, SessionEndedError } from "@/lib/api-error";
import { session } from "@/lib/session-instance";

type Resource<T> = { status: "loading" } | { status: "ready"; data: T; refreshing: boolean } | { status: "error"; message: string };

/** Loads a MyHealth API resource for a screen. A refused session is handled by the session provider (back to sign-in). */
export function usePortal<T>(path: string): Resource<T> & { reload: () => void } {
  const [state, setState] = useState<Resource<T>>({ status: "loading" });

  const load = useCallback(
    async (keep: boolean) => {
      setState((s) => (keep && s.status === "ready" ? { ...s, refreshing: true } : { status: "loading" }));
      try {
        setState({ status: "ready", data: await session.get<T>(path), refreshing: false });
      } catch (error) {
        if (error instanceof SessionEndedError) return;
        setState({ status: "error", message: patientMessage(error) });
      }
    },
    [path],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return { ...state, reload: () => void load(true) };
}
