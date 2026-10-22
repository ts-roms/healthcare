"use client";

import * as React from "react";
import { FileCheck2Icon, PenLineIcon } from "lucide-react";
import { hasEnoughInk, type SignatureStroke } from "@healthcare/domain";
import { SignaturePad } from "@healthcare/ui/healthcare";
import { Button, Input, Label, toast } from "@healthcare/ui/primitives";
import { signConsentForm } from "@/app/(staff)/clinic/procedure-actions";
import type { ProcedureForm } from "@/lib/procedure-form";

/**
 * Sign the consent form on screen (docs/architecture/electronic-signatures.md, phase 1). The signer reads the wording
 * (printed or shown), draws their name, and the member of staff records how the signer was identified. The API stores the
 * signed form as a consent form document of the patient and keeps the evidence; the form then links it as the consent.
 * Whether a drawn signature is valid for this procedure is the organization's decision: the paper route stays.
 */
export function ConsentSigning({
  id,
  definitionId,
  patientId,
  form,
  set,
}: {
  id: string;
  definitionId: string;
  patientId: string;
  form: ProcedureForm;
  set: <K extends keyof ProcedureForm>(key: K, value: ProcedureForm[K]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [strokes, setStrokes] = React.useState<SignatureStroke[]>([]);
  const [name, setName] = React.useState("");
  const [identity, setIdentity] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [padKey, setPadKey] = React.useState(0);
  const representative = form.consentGivenBy === "representative";
  const relationship = form.consentRepresentativeRelationship.trim();
  const signerName = (representative && form.consentRepresentativeName.trim()) || name.trim();
  const ready = hasEnoughInk(strokes) && signerName.length >= 2 && identity.trim().length >= 3 && (!representative || relationship.length >= 2);

  // One id per signing so a retry of the same one finds the same document.
  const requestId = React.useRef(crypto.randomUUID());
  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await signConsentForm({
        definitionId,
        patientId,
        requestId: requestId.current,
        signerKind: representative ? "representative" : "patient",
        signerName,
        ...(representative ? { signerRelationship: relationship } : {}),
        identityCheck: identity.trim(),
        strokes,
      });
      if (result.ok) {
        set("consentDocumentId", result.data.documentId);
        set("consentCapturedVia", "electronic");
        toast.success("Signed form saved and attached");
        setOpen(false);
        setStrokes([]);
        setPadKey((k) => k + 1);
        requestId.current = crypto.randomUUID();
      } else setError(result.message);
    });
  };

  const signed = form.consentDocumentId !== "" && form.consentCapturedVia === "electronic";

  return (
    <div className="grid gap-2 sm:col-span-6">
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>
            <PenLineIcon aria-hidden /> Sign on screen
          </Button>
          {signed ? (
            <span className="inline-flex items-center gap-1 text-meta text-success-foreground">
              <FileCheck2Icon className="size-3.5" aria-hidden /> Signed form attached below
            </span>
          ) : (
            <span className="text-meta text-muted-foreground">Or print the form and link its scan.</span>
          )}
        </div>
      ) : (
        // Not a <form>: this sits inside the procedure form, and a nested form would submit that one.
        <div
          role="group"
          aria-label="Sign the consent form"
          className="grid gap-2 rounded-md border bg-muted/30 p-2.5"
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
        >
          <p className="text-meta text-muted-foreground">
            The signer has read the wording shown above. They sign below; you record how you identified them. The signed form is saved to the patient&apos;s
            record.
          </p>
          {representative ? (
            <p className="text-table">
              Signing for the patient: <strong>{form.consentRepresentativeName || "name the representative above"}</strong>
              {relationship ? ` (${relationship})` : " — give the relationship above"}
            </p>
          ) : (
            <div className="grid gap-1">
              <Label htmlFor={`${id}-sign-name`}>Signer&apos;s name, as printed *</Label>
              <Input id={`${id}-sign-name`} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div className="grid gap-1">
            <Label htmlFor={`${id}-sign-identity`}>How did you identify the signer? *</Label>
            <Input
              id={`${id}-sign-identity`}
              maxLength={500}
              placeholder="e.g. PhilSys card shown, known patient"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-sign-pad`}>Signature *</Label>
            <SignaturePad key={padKey} id={`${id}-sign-pad`} onChange={setStrokes} disabled={pending} />
          </div>
          {error ? (
            <p role="alert" className="text-table text-danger-foreground">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={save} disabled={!ready || pending}>
              Save signed form
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
