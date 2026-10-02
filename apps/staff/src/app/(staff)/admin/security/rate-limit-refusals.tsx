import { Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import type { RateLimitRefusals as RateLimitRefusalsView } from "@/lib/api/types";

const isMyHealth = (route: string) => route.includes("/portal/");

/**
 * Rate-limit refusals across the platform (platform administrators): how often one address went over its allowance,
 * by route and day, MyHealth routes first. Read to decide whether patients on shared addresses are being refused before
 * any limit is changed (docs/security/access-control.md). Route templates and counts only.
 */
export function RateLimitRefusals({ view }: { view: RateLimitRefusalsView }) {
  const rows = [...view.rows].sort((a, b) => Number(isMyHealth(b.route)) - Number(isMyHealth(a.route)) || b.day.localeCompare(a.day));
  const myHealth = view.rows.filter((r) => isMyHealth(r.route)).reduce((sum, r) => sum + r.refusals, 0);
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Rate-limit refusals, last {view.days} days</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-table">
        <p className="text-muted-foreground">
          One refusal is one address that went over its allowance for that route (10 a minute for sign-in and account routes). Counts are for the whole
          platform, not one organization, by day in Philippine time. Repeated refusals on MyHealth sign-in suggest patients sharing an address (for example on
          one mobile network); each account&apos;s own lockout is separate and not counted here.
        </p>
        <p>
          MyHealth routes: {myHealth} refusal{myHealth === 1 ? "" : "s"}; all routes: {view.rows.reduce((sum, r) => sum + r.refusals, 0)}.
        </p>
        {rows.length === 0 ? (
          <p className="text-muted-foreground">No refusals in this period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Route</TableHead>
                <TableHead className="text-right">Refusals</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.day}:${r.route}`}>
                  <TableCell>{r.day}</TableCell>
                  <TableCell className="font-mono text-meta">
                    {r.route}
                    {isMyHealth(r.route) ? <span className="text-muted-foreground"> · MyHealth</span> : null}
                  </TableCell>
                  <TableCell className="text-right">{r.refusals}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
