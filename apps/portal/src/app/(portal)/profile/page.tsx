import Link from "next/link";
import { BellIcon, ChevronRightIcon, KeyRoundIcon, LockIcon, ShieldCheckIcon } from "lucide-react";
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
    ["Sign-in email", `${account.email} (${account.emailVerified ? "verified" : "not verified"})`],
    ["Two-step verification", account.mfaEnabled ? "On" : "Off"],
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
      <Link href="/privacy" className="flex items-center gap-3 rounded-xl border bg-card p-4">
        <LockIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">Privacy and consents</span>
          <span className="text-meta text-muted-foreground">See the consents you gave, and withdraw some of them</span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
      <Link href="/security" className="flex items-center gap-3 rounded-xl border bg-card p-4">
        <KeyRoundIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">Sign-in security</span>
          <span className="text-meta text-muted-foreground">Verify your email and turn on two-step verification</span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
      <Link href="/notification-settings" className="flex items-center gap-3 rounded-xl border bg-card p-4">
        <BellIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">Notification settings</span>
          <span className="text-meta text-muted-foreground">Choose which text messages and emails the clinic may send you</span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
      <p className="flex gap-2 text-body text-muted-foreground">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Something wrong? Ask the clinic to correct your record — changes are made by clinic staff so your record stays accurate.
      </p>
    </div>
  );
}
