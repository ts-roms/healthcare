import * as React from "react";
import { FileSignatureIcon, FileTextIcon, ImageIcon } from "lucide-react";
import { Badge } from "../primitives/badge";
import { clinicalDate } from "../lib/format";
import { cn } from "../lib/utils";

export interface MedicalDocumentProps {
  title: string;
  kind: "certificate" | "referral" | "result" | "imaging" | "consent" | "other";
  date: string;
  /** Who authored or produced it; omitted when unknown. */
  author?: string;
  signed?: boolean;
  href?: string;
  /** Opens the document (e.g. fetches a short-lived signed link); renders a button. Takes precedence over `href`. */
  onOpen?: () => void;
  /** Shown while `onOpen` is busy. */
  pending?: boolean;
  className?: string;
}

export function MedicalDocument({ title, kind, date, author, signed, href, onOpen, pending, className }: MedicalDocumentProps) {
  const Icon = kind === "imaging" ? ImageIcon : kind === "certificate" || kind === "consent" ? FileSignatureIcon : FileTextIcon;
  const classes = cn("flex w-full items-center gap-2.5 rounded-md border bg-card px-2.5 py-2 text-left hover:bg-accent/60", className);
  const content = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium">{title}</p>
        <p className="text-meta text-muted-foreground">
          <span className="capitalize">{kind}</span> · {clinicalDate(date)}
          {author ? ` · ${author}` : ""}
          {pending ? " · opening…" : ""}
        </p>
      </div>
      {signed === undefined ? null : signed ? <Badge variant="success">Signed</Badge> : <Badge variant="warning">Unsigned</Badge>}
    </>
  );
  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} disabled={pending} className={classes}>
        {content}
      </button>
    );
  }
  return href ? (
    <a href={href} className={classes}>
      {content}
    </a>
  ) : (
    <div className={classes}>{content}</div>
  );
}
