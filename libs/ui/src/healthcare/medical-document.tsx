import * as React from "react";
import { FileSignatureIcon, FileTextIcon, ImageIcon } from "lucide-react";
import { Badge } from "../primitives/badge";
import { clinicalDate } from "../lib/format";
import { cn } from "../lib/utils";

export interface MedicalDocumentProps {
  title: string;
  kind: "certificate" | "referral" | "result" | "imaging" | "consent" | "other";
  date: string;
  author: string;
  signed?: boolean;
  href?: string;
  className?: string;
}

export function MedicalDocument({ title, kind, date, author, signed, href, className }: MedicalDocumentProps) {
  const Icon = kind === "imaging" ? ImageIcon : kind === "certificate" || kind === "consent" ? FileSignatureIcon : FileTextIcon;
  const Comp = href ? "a" : "div";
  return (
    <Comp href={href} className={cn("flex items-center gap-2.5 rounded-md border bg-card px-2.5 py-2 hover:bg-accent/60", className)}>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium">{title}</p>
        <p className="text-meta text-muted-foreground">
          <span className="capitalize">{kind}</span> · {clinicalDate(date)} · {author}
        </p>
      </div>
      {signed === undefined ? null : signed ? <Badge variant="success">Signed</Badge> : <Badge variant="warning">Unsigned</Badge>}
    </Comp>
  );
}
