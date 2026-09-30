import Link from "next/link";
import { safeNextPath } from "@healthcare/web-session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  session: "You were signed out. Sign in again to continue.",
  signed_out: "You have signed out.",
  password_reset: "Your password was changed and you were signed out everywhere. Sign in with your new password.",
  access_withdrawn: "You withdrew your consent to MyHealth and were signed out. To use MyHealth again, give your consent at the clinic.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  return (
    <>
      <div>
        <h1 className="text-page-lg font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground">See your visits and results, and message your care team.</p>
      </div>
      <LoginForm next={safeNextPath(next, "/", ["/login", "/activate", "/forgot-password", "/reset-password"])} notice={reason ? NOTICES[reason] : undefined} />
      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-semibold">First time here?</h2>
        <p className="text-body text-muted-foreground">Ask the clinic front desk for an activation code, then set up your account.</p>
        <Link href="/activate" className="mt-2 inline-block font-medium text-primary underline-offset-4 hover:underline">
          Set up your account
        </Link>
      </section>
      <Link href="/help" className="text-center text-body font-medium text-primary underline-offset-4 hover:underline">
        How to use MyHealth
      </Link>
    </>
  );
}
