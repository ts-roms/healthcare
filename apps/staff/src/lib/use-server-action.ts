import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@healthcare/ui/primitives";

/** The shape every server action answers a form with (`ActionResult` and the narrower `{ ok } | { ok: false; message }` both fit). */
export type ServerActionOutcome = { ok: boolean; message?: string };

export type RunServerAction = (call: () => Promise<ServerActionOutcome>, success: string, after?: () => void) => void;

/**
 * Runs a server action from a client component inside a transition: on success it toasts `success`, calls `after` (close the
 * form, reset the fields) and then refreshes the page's server data — `router.refresh()` unless `refresh` says otherwise
 * (a parent's `onChanged`); on failure it toasts the action's message. `refreshOnFailure` also refreshes after a failure,
 * for screens whose refusal messages promise it ("The screen has been refreshed — check it and try again.").
 */
export function useServerAction(options: { refresh?: () => void; refreshOnFailure?: boolean } = {}): { pending: boolean; run: RunServerAction } {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const run: RunServerAction = (call, success, after) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
        if (options.refresh) options.refresh();
        else router.refresh();
      } else {
        toast.error(result.message ?? "Something went wrong.");
        if (options.refreshOnFailure) router.refresh();
      }
    });
  return { pending, run };
}
