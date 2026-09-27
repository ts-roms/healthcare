import { AppointmentCard } from "@healthcare/ui/healthcare";
import { Card, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { getAppointments } from "@/lib/demo-data";

export const metadata = { title: "Appointments" };

export default async function AppointmentsPage() {
  const appts = await getAppointments();
  return (
    <>
      <PageHeader title="Appointments" description="27 September 2026" />
      <div className="p-4">
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>Dr. Elena Reyes</CardTitle>
          </CardHeader>
          <div className="divide-y px-3">
            {appts.map((a) => (
              <AppointmentCard key={a.id} appointment={a} />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
