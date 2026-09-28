"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@healthcare/ui/primitives";
import type { InvoiceFull } from "@/lib/api/types";

export type Result = { ok: true; data?: unknown } | { ok: false; message: string };

/** Receives the invoice an action returns, so the next action uses its new version without waiting for the page refresh. */
export const InvoiceUpdate = React.createContext<(invoice: InvoiceFull) => void>(() => undefined);

function isInvoice(value: unknown): value is InvoiceFull {
  return typeof value === "object" && value !== null && "items" in value && "version" in value;
}

/** Runs an action, toasts the outcome and refreshes the page data. */
export function useAction() {
  const router = useRouter();
  const update = React.useContext(InvoiceUpdate);
  const [pending, startTransition] = React.useTransition();
  const run = (call: () => Promise<Result>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        if (isInvoice(result.data)) update(result.data);
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(result.message);
    });
  return { pending, run };
}
