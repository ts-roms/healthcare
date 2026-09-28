"use client";

import * as React from "react";
import { CreditCardIcon } from "lucide-react";
import { peso } from "@/lib/billing";
import { startOnlinePayment } from "./actions";

/** "Pay online": sends the patient to the payment provider's checkout for the invoice's balance. */
export function PayOnline({ invoiceId, balance }: { invoiceId: string; balance: number }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  // One key per attempt: a double tap starts one payment.
  const [key] = React.useState(() => crypto.randomUUID());
  return (
    <div className="mt-2 flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-body font-medium text-primary-foreground disabled:opacity-60"
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await startOnlinePayment({ invoiceId, amount: balance, idempotencyKey: key });
            if (result.ok) window.location.assign(result.data.checkoutUrl);
            else setError(result.message);
          })
        }
      >
        <CreditCardIcon className="size-4" aria-hidden /> Pay {peso(balance)} online
      </button>
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
