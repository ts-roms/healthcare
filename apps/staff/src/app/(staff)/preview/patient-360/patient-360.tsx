"use client";

import Link from "next/link";
import { FlaskConicalIcon, MonitorIcon, StethoscopeIcon } from "lucide-react";
import {
  AuditHistory,
  CarePlan,
  ClinicalSummary,
  EncounterTimeline,
  LabOrderStatusBadge,
  LabResultTable,
  LabTrendChart,
  MedicalDocument,
  MedicationList,
  Odontogram,
  PatientHeader,
  PatientTimeline,
  SummarySection,
  VitalSignsCard,
} from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from "@healthcare/ui/primitives";
import { clinicalDate } from "@healthcare/ui/healthcare";
import type { getPatientChart } from "@/lib/demo-data";

type Chart = NonNullable<Awaited<ReturnType<typeof getPatientChart>>>;

/** Patient 360: one record across clinic, lab, dental, telemedicine and billing. */
export function Patient360({ chart }: { chart: Chart }) {
  const { patient } = chart;
  const openEncounter = chart.encounters.find((e) => e.status === "in-progress");
  return (
    <div className="flex min-h-full flex-col">
      <PatientHeader
        patient={patient}
        aside={
          <>
            {openEncounter ? (
              <Button asChild size="sm">
                <Link href={`/clinic/encounters/${openEncounter.id}`}>
                  <StethoscopeIcon /> Open encounter
                </Link>
              </Button>
            ) : (
              <Button size="sm">
                <StethoscopeIcon /> New encounter
              </Button>
            )}
            <Button size="sm" variant="outline">
              <FlaskConicalIcon /> Order lab
            </Button>
            <Button size="sm" variant="outline">
              <MonitorIcon /> Teleconsult
            </Button>
          </>
        }
      />
      <Tabs defaultValue="overview" className="flex-1 gap-0">
        <TabsList className="sticky top-0 z-10 bg-card px-3">
          {["Overview", "Encounters", "Labs", "Medications", "Care Plan", "Dental", "Documents", "Billing", "Timeline"].map((t) => (
            <TabsTrigger key={t} value={t.toLowerCase().replace(" ", "-")}>
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem]">
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {chart.timeline.length ? <PatientTimeline events={chart.timeline.slice(0, 6)} /> : <p className="text-muted-foreground">No activity yet.</p>}
            </CardContent>
          </Card>
          <div className="flex flex-col gap-4">
            <VitalSignsCard vitals={chart.vitals} />
            <Card>
              <CardHeader>
                <CardTitle>Lab trend</CardTitle>
              </CardHeader>
              <CardContent>
                <LabTrendChart data={chart.hba1cTrend} name="HbA1c" unit="%" referenceLow={4} referenceHigh={5.7} />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Clinical summary</CardTitle>
            </CardHeader>
            <CardContent>
              <ClinicalSummary patient={patient}>
                {chart.carePlan ? (
                  <SummarySection title="Care plan">
                    <CarePlan plan={chart.carePlan} />
                  </SummarySection>
                ) : null}
              </ClinicalSummary>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="encounters" className="p-4">
          <Card className="max-w-3xl">
            <EncounterTimeline encounters={chart.encounters} />
          </Card>
        </TabsContent>

        <TabsContent value="labs" className="flex flex-col gap-4 p-4">
          {chart.labs.length === 0 ? <p className="text-muted-foreground">No laboratory orders.</p> : null}
          {chart.labs.map((o) => (
            <Card key={o.id}>
              <CardHeader>
                <CardTitle>{o.test}</CardTitle>
                <span className="font-mono text-meta text-muted-foreground">{o.accession}</span>
                <span className="text-meta text-muted-foreground">{clinicalDate(o.orderedAt)}</span>
                <LabOrderStatusBadge status={o.status} />
              </CardHeader>
              <LabResultTable observations={o.observations} />
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="medications" className="p-4">
          <Card className="max-w-2xl">
            <CardContent>
              <MedicationList medications={patient.medications} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="care-plan" className="p-4">
          <Card className="max-w-2xl">
            <CardContent>{chart.carePlan ? <CarePlan plan={chart.carePlan} /> : <p className="text-muted-foreground">No active care plan.</p>}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dental" className="p-4">
          <Card>
            <CardHeader>
              <CardTitle>Odontogram</CardTitle>
              <Button asChild size="xs" variant="outline" className="ml-auto">
                <Link href="/dental">Open dental chart</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <Odontogram chart={chart.dental} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="flex max-w-xl flex-col gap-2 p-4">
          <MedicalDocument title="Medical certificate" kind="certificate" date="2026-09-27" author="Dr. Elena Reyes" signed />
          <MedicalDocument
            title="Referral to Ophthalmology — diabetic eye screening"
            kind="referral"
            date="2026-09-27"
            author="Dr. Elena Reyes"
            signed={false}
          />
          <MedicalDocument title="Chest X-ray PA" kind="imaging" date="2026-06-02" author="Central Imaging" />
        </TabsContent>

        <TabsContent value="billing" className="p-4">
          <Card className="max-w-2xl">
            <CardContent className="text-muted-foreground">Invoices, PhilHealth claims and HMO approvals appear here.</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline" className="grid gap-4 p-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>All activity</CardTitle>
            </CardHeader>
            <CardContent>
              <PatientTimeline events={chart.timeline} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Record access & changes</CardTitle>
            </CardHeader>
            <CardContent>
              <AuditHistory entries={chart.audit} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
