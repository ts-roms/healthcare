import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarCheckIcon, ClockIcon } from "lucide-react";
import { AgendaList, MiniCalendar } from "./agenda-rail";
import { PractitionerCard } from "./practitioner-card";
import { StatCard } from "./stat-card";

const meta: Meta = { title: "Healthcare/Overview" };
export default meta;
type Story = StoryObj;

// Synthetic names and figures for the stories only.
export const StatCards: Story = {
  render: () => (
    <div className="grid max-w-2xl grid-cols-2 gap-4">
      <StatCard label="Appointments" value={42} icon={CalendarCheckIcon} footer="No-show rate 6%" />
      <StatCard label="Waiting" value={7} icon={ClockIcon} tone="warning" footer="Average wait 14 min" />
    </div>
  ),
};

export const Practitioners: Story = {
  render: () => (
    <div className="grid max-w-3xl grid-cols-3 gap-4">
      <PractitionerCard name="Dr. Sample One" specialty="Cardiology" hours="Mon 08:00–14:00 · Tue 08:00–14:00" available />
      <PractitionerCard name="Dr. Sample Two" specialty="Pediatrics" hours="No schedule here" available={false} />
    </div>
  ),
};

export const CalendarAndAgenda: Story = {
  render: () => (
    <div className="flex max-w-xs flex-col gap-4">
      <MiniCalendar today="2026-09-30" marked={["2026-09-18", "2026-09-25"]} />
      <AgendaList entries={[{ id: "1", tag: "Follow-up", title: "Repeat HbA1c", time: "Sample Patient", day: "18", weekday: "Fri" }]} />
    </div>
  ),
};
