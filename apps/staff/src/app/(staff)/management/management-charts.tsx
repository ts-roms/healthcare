"use client";

import { DailySeriesChart } from "@healthcare/ui/healthcare";
import { Card, CardContent } from "@healthcare/ui/primitives";
import type { ManagementDashboard } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";

/** Daily activity (counts) and daily revenue (pesos) as two charts: one unit per axis. */
export function ManagementCharts({ daily }: { daily: ManagementDashboard["daily"] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="pt-4">
          <DailySeriesChart
            title="Daily activity"
            data={daily}
            series={[
              { key: "encounters", label: "Consultations" },
              { key: "labReleased", label: "Lab tests released" },
              { key: "registered", label: "New patients" },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <DailySeriesChart
            title="Daily revenue"
            data={daily}
            series={[
              { key: "invoiced", label: "Invoiced (net)" },
              { key: "collected", label: "Collected less refunds" },
            ]}
            formatValue={peso}
          />
        </CardContent>
      </Card>
    </div>
  );
}
