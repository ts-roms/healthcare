import type { Metadata } from "next";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up this kiosk" };

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 p-8">
      <header>
        <h1 className="text-3xl font-semibold">Set up this kiosk</h1>
        <p className="mt-2 text-muted-foreground">
          For clinic staff. Sign in once with the account an administrator created for this kiosk. Patients never see this page.
        </p>
      </header>
      {reason === "session" && <p role="status">This kiosk was signed out. Sign in again to bring it back.</p>}
      <SetupForm />
    </main>
  );
}
