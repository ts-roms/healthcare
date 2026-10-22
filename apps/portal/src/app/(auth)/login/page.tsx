import Link from "next/link";
import { safeNextPath } from "@healthcare/web-session";
import { TicketIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { GetTheApp } from "@/components/app-download";
import { AuthCard } from "../form-parts";
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
      <AuthCard title="Sign in" description="See your visits and results, and message your care team.">
        <LoginForm
          next={safeNextPath(next, "/", ["/login", "/activate", "/forgot-password", "/reset-password"])}
          notice={reason ? NOTICES[reason] : undefined}
        />
      </AuthCard>
      <section className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-xs">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
          <TicketIcon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">First time here?</h2>
          <p className="text-body text-muted-foreground">Ask the clinic front desk for an activation code, then set up your account.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/activate">Set up</Link>
        </Button>
      </section>
      <GetTheApp />
      <Link href="/help" className="text-center text-body font-medium text-primary underline-offset-4 hover:underline">
        How to use MyHealth
      </Link>
    </>
  );
}
