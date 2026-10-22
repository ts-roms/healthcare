import Link from "next/link";
import { CircleHelpIcon, HeartPulseIcon, SirenIcon } from "lucide-react";

/** Signed-out pages: a single, calm column that works one-handed on a phone. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-primary-subtle to-background">
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 py-6 text-section">
        <header className="flex items-center justify-between">
          <Link href="/login" className="flex items-center gap-2 text-section font-semibold">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <HeartPulseIcon className="size-5" aria-hidden />
            </span>
            MyHealth
          </Link>
          <Link href="/help" className="flex items-center gap-1.5 rounded-md px-2 py-1 text-body font-medium hover:bg-accent">
            <CircleHelpIcon className="size-4" aria-hidden /> Help
          </Link>
        </header>
        {children}
        <p className="mt-auto flex items-center justify-center gap-1.5 pt-6 text-center text-meta text-muted-foreground">
          <SirenIcon className="size-4 shrink-0 text-danger-foreground" aria-hidden />
          In an emergency, don&apos;t use MyHealth. Call 911 or go to the nearest emergency room.
        </p>
      </main>
    </div>
  );
}
