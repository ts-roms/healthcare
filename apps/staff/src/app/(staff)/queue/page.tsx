import { QueueBoard } from "@healthcare/ui/healthcare";
import { PageHeader } from "@/components/page-header";
import { DEMO_NOW, getQueue } from "@/lib/demo-data";

export const metadata = { title: "Queue" };

export default async function QueuePage() {
  return (
    <>
      <PageHeader title="Queue" description="Main Clinic · live" />
      <div className="overflow-x-auto p-4">
        <QueueBoard entries={await getQueue()} now={DEMO_NOW} className="min-w-[60rem]" />
      </div>
    </>
  );
}
