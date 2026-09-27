import { ActivityIcon } from "lucide-react";
import { safeNextPath } from "@healthcare/web-session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  session: "Your session ended. Sign in again to continue.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ActivityIcon className="size-4" aria-hidden />
          </span>
          <div>
            <h1 className="text-section-lg font-semibold">Healthcare Platform</h1>
            <p className="text-meta text-muted-foreground">Staff sign-in</p>
          </div>
        </div>
        <LoginForm next={safeNextPath(next)} notice={reason ? NOTICES[reason] : undefined} />
      </div>
    </main>
  );
}
