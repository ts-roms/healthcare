import { HeartPulseIcon } from "lucide-react";

/** Signed-out pages: a single, calm column that works one-handed on a phone. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-8 text-section">
      <div className="flex items-center gap-2 text-section font-semibold">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <HeartPulseIcon className="size-5" aria-hidden />
        </span>
        MyHealth
      </div>
      {children}
    </main>
  );
}
