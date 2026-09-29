"use client";

import { DailySeriesChart } from "@healthcare/ui/healthcare";
import { Card, CardContent } from "@healthcare/ui/primitives";
import type { ManagementDashboard } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";

/**
 * Daily activity (counts) and daily revenue (pesos) as two charts: one unit per axis. Patient counts are not charted:
 * a day's count under five is suppressed, so a line of them would mislead. Revenue only when it is not withheld.
 */
export function ManagementCharts({ daily, revenue }: { daily: ManagementDashboard["daily"]; revenue: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="pt-4">
          <DailySeriesChart
            title="Daily activity"
            data={daily.map((d) => ({ date: d.date, encounters: d.encounters, labReleased: d.labReleased }))}
            series={[
              { key: "encounters", label: "Consultations" },
              { key: "labReleased", label: "Lab tests released" },
            ]}
          />
        </CardContent>
      </Card>
      {revenue ? (
        <Card>
          <CardContent className="pt-4">
            <DailySeriesChart
              title="Daily revenue"
              data={daily.map((d) => ({ date: d.date, invoiced: d.invoiced ?? 0, collected: d.collected ?? 0 }))}
              series={[
                { key: "invoiced", label: "Invoiced (net)" },
                { key: "collected", label: "Collected less refunds" },
              ]}
              formatValue={peso}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
