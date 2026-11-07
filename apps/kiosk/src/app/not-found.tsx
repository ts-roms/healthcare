import Link from "next/link";

export const metadata = { title: "Page not found" };

/** A mistyped address on the kiosk: nothing technical, one way back. */
export default function KioskNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-primary-subtle p-10 text-center">
      <h1 className="text-5xl font-semibold">We cannot find that page</h1>
      <p className="max-w-2xl text-3xl">Please go back to the start, or check in at the front desk.</p>
      <Link href="/" className="inline-flex min-h-16 items-center rounded-full bg-primary px-8 text-2xl font-medium text-primary-foreground">
        Go to the start
      </Link>
    </main>
  );
}
