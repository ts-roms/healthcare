import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { MfaPolicy, PatientMfaPolicy, RateLimitRefusals as RateLimitRefusalsView } from "@/lib/api/types";
import { RateLimitRefusals } from "./rate-limit-refusals";
import { MfaExemptionControl, MfaPolicyToggle, PatientMfaPolicyControl } from "./security-controls";

export const metadata = { title: "Sign-in security" };

/** The organization's two-step verification requirement for staff: who has it, who still needs it, who is exempt. */
export default async function SignInSecurityPage() {
  const session = await getSession();
  if (!can(session, "user.read")) redirect("/");
  const [policy, patients, refusals] = await Promise.all([
    api<MfaPolicy>("/security/mfa-policy"),
    api<PatientMfaPolicy>("/security/patient-mfa-policy"),
    // Platform-wide refusal counts: platform administrators only (the API refuses everyone else).
    session.user.isPlatformAdmin ? api<RateLimitRefusalsView>("/rate-limits/refusals?days=30").catch(() => null) : Promise.resolve(null),
  ]);
  const manage = can(session, "user.mfa.manage");
  return (
    <>
      <PageHeader title="Sign-in security" description="Two-step verification for staff and patients" />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Two-step verification for staff</CardTitle>
            {policy.required ? (
              <Badge variant="success" className="ml-auto">
                <ShieldCheckIcon aria-hidden /> Required
              </Badge>
            ) : (
              <Badge variant="neutral" className="ml-auto">
                <ShieldOffIcon aria-hidden /> Optional
              </Badge>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <p className="text-muted-foreground">
              When required, a staff member without it can sign in only to set it up (a 6-digit code from an authenticator app). Nobody is locked out; they
              cannot open anything else until it is on, and they cannot turn it off.
            </p>
            <p>
              {policy.members.active} active member{policy.members.active === 1 ? "" : "s"}: {policy.members.withMfa} with it on, {policy.members.exempt}{" "}
              exempt, {policy.members.withoutMfa} without it.
            </p>
            {policy.updatedBy && policy.updatedAt ? (
              <p className="text-meta text-muted-foreground">
                Last changed by {policy.updatedBy.displayName}, {clinicalDateTime(policy.updatedAt)}.
              </p>
            ) : null}
            {manage ? <MfaPolicyToggle required={policy.required} version={policy.version} ownMfaEnabled={session.user.mfaEnabled} /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Exempt accounts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <p className="text-muted-foreground">
              For integration accounts that sign in without a person (the instrument gateway, a FHIR sender). Exempt one from the staff user&apos;s page.
            </p>
            {policy.exemptions.length === 0 ? (
              <p className="text-muted-foreground">No exempt accounts.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Exempted</TableHead>
                    {manage ? <TableHead className="sr-only">Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policy.exemptions.map((e) => (
                    <TableRow key={e.userId}>
                      <TableCell>
                        <Link className="text-primary hover:underline" href={`/admin/users/${e.userId}`}>
                          {e.displayName}
                        </Link>
                        <div className="text-meta text-muted-foreground">{e.email}</div>
                      </TableCell>
                      <TableCell className="whitespace-normal">{e.reason}</TableCell>
                      <TableCell>
                        {clinicalDateTime(e.exemptedAt)}
                        {e.exemptedBy ? <div className="text-meta text-muted-foreground">by {e.exemptedBy}</div> : null}
                      </TableCell>
                      {manage ? (
                        <TableCell>
                          <MfaExemptionControl userId={e.userId} exempt />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Two-step verification for patients (MyHealth)</CardTitle>
            {patients.required ? (
              <Badge variant="success" className="ml-auto">
                <ShieldCheckIcon aria-hidden /> Required{patients.requiredFrom ? ` from ${patients.requiredFrom}` : ""}
              </Badge>
            ) : (
              <Badge variant="neutral" className="ml-auto">
                <ShieldOffIcon aria-hidden /> Optional
              </Badge>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <p className="text-muted-foreground">
              Patients can always add an authenticator app in MyHealth. When required, the date is announced in MyHealth first (at least a week), and patients
              who still need to set it up are told by email when it is turned on or the date moves; from the date a patient without it signs in only to set it
              up. Patients may remember a browser for 30 days after a code. From the patient record the clinic turns it off for a patient who lost the phone and
              the recovery codes, or exempts a patient who cannot use an authenticator app.
            </p>
            <p>
              {patients.accounts.active} active MyHealth account{patients.accounts.active === 1 ? "" : "s"}: {patients.accounts.withMfa} with it on,{" "}
              {patients.accounts.exempt} exempt, {patients.accounts.withoutMfa} without it.
            </p>
            {patients.exemptions.length ? (
              <ul className="flex flex-col gap-1" aria-label="Exempt patients">
                {patients.exemptions.map((e) => (
                  <li key={e.patientId} className="flex flex-wrap gap-x-2">
                    <Link className="text-primary hover:underline" href={`/patients/${e.patientId}`}>
                      Patient record
                    </Link>
                    <span className="text-muted-foreground">
                      {e.reason} · {clinicalDateTime(e.exemptedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {patients.updatedBy && patients.updatedAt ? (
              <p className="text-meta text-muted-foreground">
                Last changed by {patients.updatedBy.displayName}, {clinicalDateTime(patients.updatedAt)}.
              </p>
            ) : null}
            {manage ? <PatientMfaPolicyControl required={patients.required} requiredFrom={patients.requiredFrom} version={patients.version} /> : null}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Still without two-step verification</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            {policy.pending.length === 0 ? (
              <p className="text-muted-foreground">Every active member has it on or is exempt.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policy.pending.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link className="text-primary hover:underline" href={`/admin/users/${p.id}`}>
                          {p.displayName}
                        </Link>
                      </TableCell>
                      <TableCell>{p.email}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        {refusals ? <RateLimitRefusals view={refusals} /> : null}
      </div>
    </>
  );
}
