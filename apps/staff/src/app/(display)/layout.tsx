/**
 * Screens shown to the public (the waiting-room display): no navigation, no staff details. The session is still the
 * staff session (proxy.ts) — a display account holding only `clinic.queue.display`, or a member who opened it.
 */
export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background text-foreground">{children}</div>;
}
