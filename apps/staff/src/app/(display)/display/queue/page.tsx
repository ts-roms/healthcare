import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { QueueDisplay } from "@/lib/api/types";
import { isDisplayOnly, QUEUE_DISPLAY_PERMISSION } from "@/lib/queue-display";
import { setRequestTimeZone } from "@/lib/time-zone";
import { DisplayBoard } from "./display-board";

export const metadata = { title: "Waiting-room display" };

/**
 * The waiting-room display (migration 0112): tickets called and where to go, and how many wait. Shown on a screen in
 * the waiting area, signed in with a display account; reception can open it too. Never a patient detail.
 */
export default async function QueueDisplayPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, QUEUE_DISPLAY_PERMISSION)) {
    return (
      <Notice>
        The waiting-room display is not available to you. <Link href="/">Back to the staff app</Link>
      </Notice>
    );
  }
  if (!facility) {
    return (
      <Notice>
        Choose a facility first: the display shows one facility&apos;s queue. <Link href="/">Back to the staff app</Link>
      </Notice>
    );
  }
  setRequestTimeZone(facility.timezone);
  let display: QueueDisplay | null = null;
  try {
    display = await api<QueueDisplay>("/queue/display");
  } catch (error) {
    // The board keeps trying (live updates, then every 15 s); a sign-in problem still goes to the sign-in page.
    unstable_rethrow(error);
  }
  return <DisplayBoard display={display} facilityName={facility.name} timeZone={facility.timezone} canLeave={!isDisplayOnly(session.permissions)} />;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center p-4">
      <p className="text-body text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 [&_a]:hover:underline">{children}</p>
    </main>
  );
}
