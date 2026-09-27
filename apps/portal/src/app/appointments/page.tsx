import { appointments } from "@healthcare/domain/fixtures";
import { AppointmentCard } from "@healthcare/ui/healthcare";
import { Button } from "@healthcare/ui/primitives";
import { CalendarPlusIcon } from "lucide-react";

export const metadata = { title: "Visits" };

export default function AppointmentsPage() {
  const mine = appointments.slice(0, 1).map((a) => ({ ...a, start: "2026-09-28T10:00:00+08:00", status: "booked" as const }));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-page-lg font-semibold">Visits</h1>
        <Button size="lg">
          <CalendarPlusIcon /> Book
        </Button>
      </div>
      {mine.map((a) => (
        <AppointmentCard
          key={a.id}
          variant="card"
          appointment={a}
          action={
            <Button variant="outline" size="sm">
              Reschedule
            </Button>
          }
        />
      ))}
    </div>
  );
}
