"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { hasEnoughInk, type SignatureStroke } from "@healthcare/domain";
import { clinicalDateTime, SignaturePad } from "@healthcare/ui/healthcare";
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
  // With a saved signature the pad stays closed until "Update signature"; without one it is the way in.
  const [updating, setUpdating] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const showPad = !mine.signature || updating;
  const closePad = () => {
    setUpdating(false);
    setStrokes([]);
    setPadKey((k) => k + 1);
    setError(null);
  };
  return (
    <div className="flex flex-col gap-3">
      {mine.signature ? (
        <>
          <SignaturePreview strokes={mine.signature.strokes} />
          <p className="text-meta text-muted-foreground">Saved {clinicalDateTime(mine.signature.drawnAt)}</p>
        </>
      ) : (
        <p className="text-muted-foreground">You have not drawn a signature.</p>
      )}
      <p className="text-muted-foreground">
        {mine.enabled
          ? "Your clinic prints it on the medical certificates and referral letters you issue. Documents already issued keep the signature they printed."
          : "Your clinic does not print signatures on certificates and letters yet; an administrator can turn it on."}
      </p>
      {showPad ? (
        <div className="flex flex-col gap-1.5">
          <span className="font-medium">{mine.signature ? "Draw your new signature" : "Draw your signature"}</span>
          <SignaturePad key={padKey} id="my-signature-pad" onChange={setStrokes} disabled={pending} />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {showPad ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={pending || !hasEnoughInk(strokes)}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await drawMySignature(strokes);
                  if (result.ok) {
                    toast.success(mine.signature ? "Signature updated" : "Signature saved");
                    closePad();
                    router.refresh();
                  } else setError(result.message);
                })
              }
            >
              {mine.signature ? "Save new signature" : "Save signature"}
            </Button>
            {mine.signature ? (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={closePad}>
                Cancel
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button type="button" size="sm" onClick={() => setUpdating(true)}>
              Update signature
            </Button>
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
          </>
        )}
      </div>
    </div>
  );
}
