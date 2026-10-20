import Link from "next/link";
import { CheckCircle2Icon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import type { RecordCompleteness } from "@/lib/patient-profile";

/** How much of the registration details are filled in and what to ask next (a prompt for the front desk, not a clinical rule). */
export function CompletenessCard({ completeness, editHref }: { completeness: RecordCompleteness; editHref?: string }) {
  const { percent, missing } = completeness;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record {percent}% complete</CardTitle>
        {editHref && missing.length > 0 ? (
          <Button asChild size="sm" variant="ghost" className="ml-auto">
            <Link href={editHref}>Complete record</Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          role="progressbar"
          aria-label="Registration details filled in"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        {missing.length ? (
          <p className="text-table text-muted-foreground">
            <span className="font-medium text-foreground">Still to ask: </span>
            {missing.join(" · ")}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-table text-muted-foreground">
            <CheckCircle2Icon className="size-4 text-success-foreground" aria-hidden /> Everything the front desk can ask for is recorded.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
