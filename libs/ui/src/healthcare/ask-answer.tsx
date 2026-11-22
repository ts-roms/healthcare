import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, LockIcon, MinusIcon, TriangleAlertIcon } from "lucide-react";
import { DefaultLink, type LinkComponent } from "../layouts/link";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Explain } from "../primitives/explain";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../primitives/table";
import { cn } from "../lib/utils";

/** An answer of the assistant's Ask as the card shows it (the API words and formats every figure). */
export interface AskAnswerView {
  title: string;
  status: "answered" | "withheld" | "unavailable";
  sentence: string;
  /** "Last week · 9–15 November 2026". */
  periodText?: string | null;
  /** "the period before · 2–8 November 2026". */
  comparisonText?: string | null;
  scopeName: string;
  rows: Array<{
    label: string;
    value: string;
    previous?: string;
    change?: { text: string; direction: "up" | "down" | "flat"; assessment: "better" | "worse" | "unchanged" | "neutral" };
  }>;
  notes: string[];
  definition?: string | null;
  link?: { label: string; href: string } | null;
}

const ASSESSMENT: Record<NonNullable<AskAnswerView["rows"][number]["change"]>["assessment"], { label: string; className: string }> = {
  better: { label: "better", className: "text-success-foreground" },
  worse: { label: "worse", className: "text-danger-foreground" },
  unchanged: { label: "unchanged", className: "text-muted-foreground" },
  neutral: { label: "", className: "text-muted-foreground" },
};

/**
 * One answer of the assistant's Ask (docs/domains/assistant.md, "Ask"): the question, the dates and place it covers, one
 * sentence, the figures (with the comparison when asked: the change as an arrow, words and colour, never colour alone),
 * notes, how the figures are worked out and where the full figures are. Presentational: the app fetches and passes it.
 */
export function AskAnswerCard({
  answer,
  actions,
  Link = DefaultLink,
  id = "ask-answer",
  className,
}: {
  answer: AskAnswerView;
  /** Beside the heading, e.g. Save. */
  actions?: React.ReactNode;
  /** Renders on the server too (no hooks), so a router's `Link` can be passed; `id` names the heading. */
  Link?: LinkComponent;
  id?: string;
  className?: string;
}) {
  const headingId = `${id}-title`;
  const compared = answer.rows.some((r) => r.previous !== undefined);
  const meta = [answer.periodText, answer.scopeName].filter(Boolean).join(" · ");
  return (
    <section aria-labelledby={headingId} className={cn("rounded-xl border border-border/70 bg-card p-4 text-card-foreground shadow-xs", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-page-sm font-semibold">
            {answer.title}
          </h2>
          {meta ? <p className="text-table text-muted-foreground">{meta}</p> : null}
          {answer.comparisonText ? <p className="text-table text-muted-foreground">Compared with {answer.comparisonText}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {answer.status === "answered" ? <Badge variant="neutral">From your own records</Badge> : null}
        </div>
      </div>

      <p className={cn("mt-3 flex items-start gap-2 text-body", answer.status !== "answered" && "text-muted-foreground")} aria-live="polite">
        {answer.status === "withheld" ? <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
        {answer.status === "unavailable" ? <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
        <span>{answer.sentence}</span>
      </p>

      {answer.rows.length > 0 ? (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Figure</TableHead>
              <TableHead scope="col" className="text-right">
                {compared ? "This period" : "Value"}
              </TableHead>
              {compared ? (
                <TableHead scope="col" className="text-right">
                  Compared with
                </TableHead>
              ) : null}
              {compared ? <TableHead scope="col">Change</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {answer.rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell className="whitespace-normal">{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{r.value}</TableCell>
                {compared ? <TableCell className="text-right text-muted-foreground tabular-nums">{r.previous ?? "—"}</TableCell> : null}
                {compared ? <TableCell>{r.change ? <Change change={r.change} /> : <span className="text-muted-foreground">—</span>}</TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {answer.notes.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-table text-muted-foreground">
          {answer.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      {answer.definition || answer.link ? (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {answer.definition ? (
            <Explain summary="How this was calculated" className="min-w-64 flex-1">
              <p>{answer.definition}</p>
            </Explain>
          ) : null}
          {answer.link ? (
            <Button asChild size="sm" variant="outline">
              <Link href={answer.link.href}>{answer.link.label}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Change({ change }: { change: NonNullable<AskAnswerView["rows"][number]["change"]> }) {
  const Icon = change.direction === "up" ? ArrowUpIcon : change.direction === "down" ? ArrowDownIcon : MinusIcon;
  const spec = ASSESSMENT[change.assessment];
  return (
    <span className={cn("inline-flex items-center gap-1 text-table", spec.className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {change.text}
      {spec.label ? <span className="text-muted-foreground">({spec.label})</span> : null}
    </span>
  );
}
