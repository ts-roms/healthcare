import { safeNextPath } from "@healthcare/web-session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  session: "Your session ended. Sign in again to continue.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-page-lg font-semibold tracking-tight">Welcome back</h1>
        <p className="text-body text-muted-foreground">Sign in to your staff account to continue.</p>
      </div>
      <LoginForm next={safeNextPath(next)} notice={reason ? NOTICES[reason] : undefined} />
      <p className="text-meta text-muted-foreground">Trouble signing in? Ask your organization administrator to reset your password or authenticator.</p>
    </div>
  );
}
