import Link from "next/link";
import { EncounterTimeline } from "@healthcare/ui/healthcare";
import { Card } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { getPatientChart } from "@/lib/demo-data";

export const metadata = { title: "Encounters" };

export default async function EncountersPage() {
  const chart = await getPatientChart("p-10293");
  return (
    <>
      <PageHeader title="Encounters" description="Open and recent encounters" />
      <div className="p-4">
        <Card className="max-w-3xl">
          <EncounterTimeline encounters={chart?.encounters ?? []} />
        </Card>
        <p className="mt-2 text-meta text-muted-foreground">
          Demo: open the{" "}
          <Link href="/clinic/encounters/e-5501" className="text-primary hover:underline">
            in-progress consultation
          </Link>
          .
        </p>
      </div>
    </>
  );
}
