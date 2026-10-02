"use client";

import { PaperclipIcon } from "lucide-react";
import { Input, Label } from "@healthcare/ui/primitives";
import { ATTACHMENT_TYPES, ATTACHMENTS_MAX, fileSize } from "@/lib/conversations";

/** Chooses photos or PDFs to send with a message; the server action uploads them and the API checks each one. */
export function AttachmentPicker({ id, files, onChange }: { id: string; files: File[]; onChange: (files: File[]) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="flex items-center gap-1">
        <PaperclipIcon className="size-4" aria-hidden /> Add a photo or PDF (optional)
      </Label>
      <Input
        id={id}
        name="files"
        type="file"
        multiple
        accept={ATTACHMENT_TYPES.join(",")}
        onChange={(e) => onChange(Array.from(e.target.files ?? []))}
        aria-describedby={`${id}-help`}
        className="h-11"
      />
      <p id={`${id}-help`} className="text-meta text-muted-foreground">
        Up to {ATTACHMENTS_MAX} files of 10 MB or less with one message, for example a photo of a rash or a referral letter. The clinic keeps them in your
        record.
      </p>
      {files.length ? (
        <ul className="text-meta text-muted-foreground" aria-label="Files to send">
          {files.map((f) => (
            <li key={`${f.name}-${f.size}`}>
              {f.name} ({fileSize(f.size)})
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
