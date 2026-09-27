"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { Button, Input, toast } from "@healthcare/ui/primitives";
import type { ExchangeReviewItem } from "@/lib/api/types";
import { requeueExchange, resolveExchange } from "./actions";

/** Re-queue a stalled exchange, or record a resolution on an unsuccessful one. */
export function ExchangeRowActions({ exchange }: { exchange: ExchangeReviewItem }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [resolving, setResolving] = React.useState(false);
  const [note, setNote] = React.useState("");
  const act = (call: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        setResolving(false);
        router.refresh();
      } else toast.error(result.message);
    });

  if (exchange.status === "queued") {
    return exchange.stalled && exchange.payloadSealed ? (
      <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => act(() => requeueExchange({ exchangeId: exchange.id }), "Re-queued")}>
        <RotateCcwIcon /> Re-queue
      </Button>
    ) : null;
  }
  if (exchange.status === "accepted" || exchange.resolvedAt) return null;
  if (!resolving) {
    return (
      <Button type="button" size="xs" variant="outline" onClick={() => setResolving(true)}>
        <CheckIcon /> Resolve…
      </Button>
    );
  }
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        act(() => resolveExchange({ exchangeId: exchange.id, note }), "Resolved");
      }}
    >
      <Input
        aria-label="What was done"
        placeholder="What was done"
        className="h-7 w-56"
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button type="submit" size="xs" disabled={pending || note.trim().length < 3}>
        Save
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={() => setResolving(false)}>
        Cancel
      </Button>
    </form>
  );
}
