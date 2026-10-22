"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { hasEnoughInk, type SignatureStroke } from "@healthcare/domain";
import { SignaturePad } from "@healthcare/ui/healthcare";
import { Button, toast } from "@healthcare/ui/primitives";
import type { MyPractitionerSignature } from "@/lib/api/types";
import { drawMySignature, withdrawMySignature } from "./actions";

/** The saved signature, drawn as vector lines in a 3:1 box (the strokes are only ever shown to their owner). */
function SignaturePreview({ strokes }: { strokes: number[][][] }) {
  return (
    <svg role="img" aria-label="Your saved signature" viewBox="0 0 300 100" className="aspect-[3/1] w-full max-w-xs rounded-md border bg-white">
      {strokes.map((stroke, i) => (
        <polyline
          key={i}
          fill="none"
          stroke="#111111"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={stroke.map(([x, y]) => `${(x ?? 0) * 300},${(y ?? 0) * 100}`).join(" ")}
        />
      ))}
    </svg>
  );
}

/**
 * The practitioner's own signature for the medical certificates and referral letters they issue
 * (docs/architecture/electronic-signatures.md, phase 3). Drawn once; only they see or change it. A mark on a document is
 * cosmetic: who issued it is recorded by the system either way. Documents already issued keep the signature they printed.
 */
export function MySignature({ mine }: { mine: MyPractitionerSignature }) {
  const router = useRouter();
  const [strokes, setStrokes] = React.useState<SignatureStroke[]>([]);
  const [padKey, setPadKey] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  return (
    <div className="flex flex-col gap-3">
      {mine.signature ? <SignaturePreview strokes={mine.signature.strokes} /> : <p className="text-muted-foreground">You have not drawn a signature.</p>}
      <p className="text-muted-foreground">
        {mine.enabled
          ? "Your clinic prints it on the medical certificates and referral letters you issue."
          : "Your clinic does not print signatures on certificates and letters yet; an administrator can turn it on."}
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="font-medium">{mine.signature ? "Draw a new one" : "Draw your signature"}</span>
        <SignaturePad key={padKey} id="my-signature-pad" onChange={setStrokes} disabled={pending} />
      </div>
      {error ? (
        <p role="alert" className="text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !hasEnoughInk(strokes)}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await drawMySignature(strokes);
              if (result.ok) {
                toast.success("Signature saved");
                setStrokes([]);
                setPadKey((k) => k + 1);
                router.refresh();
              } else setError(result.message);
            })
          }
        >
          Save signature
        </Button>
        {mine.signature ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await withdrawMySignature();
                if (result.ok) {
                  toast.success("Signature removed");
                  router.refresh();
                } else setError(result.message);
              })
            }
          >
            Remove it
          </Button>
        ) : null}
      </div>
    </div>
  );
}
