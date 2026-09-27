import { CalendarIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Visits" };

export default function AppointmentsPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-page-lg font-semibold">Visits</h1>
      <EmptyState icon={CalendarIcon} title="Online booking is not available yet">
        To book, change or cancel a visit — in person or online — contact the clinic. Your visits will be listed here once booking opens in MyHealth.
      </EmptyState>
    </div>
  );
}
