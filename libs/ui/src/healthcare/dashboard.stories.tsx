import type { Meta, StoryObj } from "@storybook/react-vite";
import { DailySeriesChart } from "./daily-series-chart";

const meta: Meta = { title: "Healthcare/Dashboards" };
export default meta;

// Synthetic figures for the story only.
const days = Array.from({ length: 30 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const open = weekday !== 0;
  return {
    date,
    encounters: open ? 30 + ((i * 7) % 13) : 4,
    labReleased: open ? 55 + ((i * 11) % 21) : 9,
    registered: open ? 6 + (i % 5) : 1,
    invoiced: open ? 4_500_000 + ((i * 131_000) % 900_000) : 600_000,
    collected: open ? 4_100_000 + ((i * 97_000) % 800_000) : 550_000,
  };
});
const peso = (centavos: number) => `₱${(centavos / 100).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

export const DailyActivity: StoryObj = {
  render: () => (
    <div className="max-w-2xl">
      <DailySeriesChart
        title="Daily activity"
        data={days}
        series={[
          { key: "encounters", label: "Consultations" },
          { key: "labReleased", label: "Lab tests released" },
          { key: "registered", label: "New patients" },
        ]}
      />
    </div>
  ),
};

export const DailyRevenue: StoryObj = {
  render: () => (
    <div className="max-w-2xl">
      <DailySeriesChart
        title="Daily revenue"
        data={days}
        series={[
          { key: "invoiced", label: "Invoiced (net)" },
          { key: "collected", label: "Collected less refunds" },
        ]}
        formatValue={peso}
      />
    </div>
  ),
};
