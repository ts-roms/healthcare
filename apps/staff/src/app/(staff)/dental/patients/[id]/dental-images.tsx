"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, UploadIcon } from "lucide-react";
import { toothLabel, type ToothNotation } from "@healthcare/domain";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { DentalImage, DentalImageKind } from "@/lib/api/types";
import { IMAGE_KINDS } from "@/lib/dental-mapping";
import { addDentalImage, dentalImageLink, markImageEnteredInError } from "../../actions";
import { EnteredInError } from "./entered-in-error";

/**
 * Radiographs and photos. Files are private documents in object storage; opening one asks the API for a short-lived
 * signed link (audited). Only metadata lives in the dental record.
 */
export function DentalImages({
  patientId,
  images,
  notation,
  encounterId,
  today,
  canRead,
  canUpload,
  canCorrect,
}: {
  patientId: string;
  images: DentalImage[];
  notation: ToothNotation;
  encounterId: string | null;
  today: string;
  canRead: boolean;
  canUpload: boolean;
  canCorrect: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [documentId, setDocumentId] = React.useState<string | undefined>();
  const [idempotencyKey, setKey] = React.useState(() => crypto.randomUUID());
  const formRef = React.useRef<HTMLFormElement>(null);

  const upload = (data: FormData) =>
    startTransition(async () => {
      data.set("idempotencyKey", idempotencyKey);
      if (documentId) data.set("documentId", documentId);
      if (encounterId) data.set("encounterId", encounterId);
      const result = await addDentalImage(patientId, data);
      if (result.ok) {
        toast.success("Image added");
        setDocumentId(undefined);
        setKey(crypto.randomUUID());
        formRef.current?.reset();
        router.refresh();
      } else {
        if (result.documentId) setDocumentId(result.documentId);
        toast.error(result.message);
      }
    });

  const open = (imageId: string) =>
    startTransition(async () => {
      const result = await dentalImageLink(imageId);
      if (result.ok) window.open(result.data.url, "_blank", "noopener,noreferrer");
      else toast.error(result.message);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Imaging</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canUpload ? (
          <form ref={formRef} action={upload} className="flex flex-wrap items-end gap-3 rounded-md border p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="image-file">File</Label>
              <Input
                id="image-file"
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/heic,image/tiff,application/dicom,.dcm"
                disabled={Boolean(documentId)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="image-kind">Kind</Label>
              <NativeSelect id="image-kind" name="kind" defaultValue="periapical">
                {(Object.entries(IMAGE_KINDS) as Array<[DentalImageKind, string]>).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex w-36 flex-col gap-1.5">
              <Label htmlFor="image-teeth">Teeth (FDI)</Label>
              <Input id="image-teeth" name="teeth" placeholder="e.g. 36 37" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="image-date">Taken on</Label>
              <Input id="image-date" name="takenOn" type="date" defaultValue={today} max={today} />
            </div>
            <div className="flex min-w-48 flex-1 flex-col gap-1.5">
              <Label htmlFor="image-notes">Notes</Label>
              <Input id="image-notes" name="notes" maxLength={1000} />
            </div>
            <Button type="submit" disabled={pending}>
              <UploadIcon /> {documentId ? "Add stored file" : "Upload"}
            </Button>
          </form>
        ) : null}
        {images.length === 0 ? <p className="text-body text-muted-foreground">No radiographs or photos.</p> : null}
        <ul className="divide-y text-table" aria-label="Dental images">
          {images.map((image) => {
            const error = image.status === "entered_in_error";
            return (
              <li key={image.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="tabular w-24 text-meta text-muted-foreground">{clinicalDate(image.takenOn)}</span>
                <span className={error ? "min-w-0 flex-1 text-muted-foreground line-through" : "min-w-0 flex-1"}>
                  {IMAGE_KINDS[image.kind]}
                  {image.teeth.length ? ` · ${image.teeth.map((t) => toothLabel(t, notation)).join(", ")}` : ""}
                  {image.notes ? <span className="text-muted-foreground"> · {image.notes}</span> : null}
                </span>
                {error ? (
                  <Badge variant="neutral" title={image.enteredInErrorReason ?? undefined}>
                    Entered in error
                  </Badge>
                ) : (
                  <>
                    {canRead ? (
                      <Button size="xs" variant="outline" onClick={() => open(image.id)} disabled={pending}>
                        <ExternalLinkIcon /> Open
                      </Button>
                    ) : null}
                    {canCorrect ? <EnteredInError what="Image" onConfirm={(reason) => markImageEnteredInError(patientId, image.id, reason)} /> : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
