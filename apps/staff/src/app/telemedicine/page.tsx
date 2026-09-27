import Link from "next/link";
import { AppointmentCard } from "@healthcare/ui/healthcare";
import { Button, Card } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { getAppointments } from "@/lib/data";

export const metadata = { title: "Telemedicine" };

export default async function TelemedicinePage() {
  const online = (await getAppointments()).filter((a) => a.mode === "online");
  return (
    <>
      <PageHeader title="Telemedicine" description="Today's online consultations" />
      <div className="p-4">
        <Card className="max-w-2xl divide-y px-3">
          {online.map((a) => (
            <AppointmentCard
              key={a.id}
              appointment={a}
              action={
                <Button asChild size="xs">
                  <Link href="/telemedicine/e-5302">Start</Link>
                </Button>
              }
            />
          ))}
        </Card>
      </div>
    </>
  );
}
