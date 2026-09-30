import type { Meta, StoryObj } from "@storybook/react-vite";
import { appointments, facilities, providers, queue } from "@healthcare/domain/fixtures";
import { Button } from "../primitives/button";
import { ActionMetric, AttentionList } from "./action-dashboard";
import { AppointmentCard } from "./appointment-card";
import { QueueBoard } from "./queue-board";
import { FacilitySelector, ProviderSelector } from "./selectors";

const meta: Meta = { title: "Healthcare/Operations" };
export default meta;

export const Queue: StoryObj = { render: () => <QueueBoard entries={queue} now={new Date("2026-09-27T10:05:00+08:00")} /> };

export const Appointments: StoryObj = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="divide-y rounded-md border bg-card px-3">
        {appointments.map((a) => (
          <AppointmentCard key={a.id} appointment={a} />
        ))}
      </div>
      {appointments[2] ? <AppointmentCard variant="card" appointment={appointments[2]} action={<Button size="sm">Join</Button>} /> : null}
    </div>
  ),
};

export const DoctorDashboard: StoryObj = {
  render: () => (
    <div className="grid max-w-3xl gap-4 md:grid-cols-[14rem_1fr]">
      <div className="flex flex-col rounded-lg border bg-card p-1">
        <ActionMetric value={12} label="Patients" />
        <ActionMetric value={3} label="Waiting" tone="warning" />
        <ActionMetric value={2} label="Online" />
        <ActionMetric value={4} label="Follow-ups" />
      </div>
      <AttentionList
        items={[
          { id: "1", severity: "critical", count: 3, title: "Critical lab results", detail: "Potassium 6.4 mmol/L — Juan Cruz", href: "#" },
          { id: "2", severity: "warning", count: 5, title: "Patients due for follow-up", href: "#" },
          { id: "3", severity: "warning", count: 2, title: "Unsigned encounters", href: "#" },
        ]}
      />
    </div>
  ),
};

export const Selectors: StoryObj = {
  render: () => (
    <div className="flex gap-2">
      <ProviderSelector providers={providers} />
      <FacilitySelector facilities={facilities} />
    </div>
  ),
};
