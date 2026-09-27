import Link from "next/link";
import { AllergyList, ageFrom, fullName, PatientAvatar, sexLabel } from "@healthcare/ui/healthcare";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { getPatients } from "@/lib/data";

export const metadata = { title: "Patients" };

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const needle = q.trim().toLowerCase();
  const patients = (await getPatients()).filter((p) => !needle || fullName(p).toLowerCase().includes(needle) || p.mrn.includes(needle));
  return (
    <>
      <PageHeader title="Patients" description={needle ? `${patients.length} result(s) for “${q}”` : `${patients.length} patients`} />
      <div className="bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>MRN</TableHead>
              <TableHead>Age / Sex</TableHead>
              <TableHead>Allergies</TableHead>
              <TableHead>Active problems</TableHead>
              <TableHead>PhilHealth</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {patients.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/patients/${p.id}`} className="flex items-center gap-2 font-medium text-primary hover:underline">
                    <PatientAvatar patient={p} size="sm" />
                    {fullName(p)}
                  </Link>
                </TableCell>
                <TableCell className="font-mono">{p.mrn}</TableCell>
                <TableCell>
                  {ageFrom(p.birthDate)} {sexLabel(p.sex, true)}
                </TableCell>
                <TableCell>
                  <AllergyList allergies={p.allergies} />
                </TableCell>
                <TableCell className="max-w-64 truncate text-muted-foreground">{p.problems.map((x) => x.description).join(", ") || "—"}</TableCell>
                <TableCell>
                  {p.philHealth ? (
                    <Badge variant={p.philHealth.verified ? "success" : "warning"}>{p.philHealth.verified ? "✓ Verified" : "Unverified"}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
