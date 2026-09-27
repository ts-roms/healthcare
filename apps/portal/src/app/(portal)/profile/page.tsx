import { ShieldCheckIcon } from "lucide-react";
import { getMe } from "@/lib/api/session";
import { formatCalendarDate } from "@/lib/greeting";

export const metadata = { title: "Profile" };

const SEX: Record<string, string> = { male: "Male", female: "Female", intersex: "Intersex", unknown: "Not recorded" };

export default async function ProfilePage() {
  const { patient, organization, account } = await getMe();
  const rows: [string, string][] = [
    ["Name", patient.displayName],
    ["Patient number", patient.patientNumber],
    ["Date of birth", formatCalendarDate(patient.birthDate)],
    ["Sex", SEX[patient.sex] ?? patient.sex],
    ["Clinic", organization.name],
    ["Sign-in email", account.email],
  ];
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-page-lg font-semibold">Profile</h1>
      <dl className="divide-y rounded-xl border bg-card">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 p-4 sm:flex-row sm:gap-4">
            <dt className="text-body text-muted-foreground sm:w-40">{label}</dt>
            <dd className="font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="flex gap-2 text-body text-muted-foreground">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Something wrong? Ask the clinic to correct your record — changes are made by clinic staff so your record stays accurate.
      </p>
    </div>
  );
}
