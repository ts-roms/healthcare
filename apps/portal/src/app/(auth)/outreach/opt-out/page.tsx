import Link from "next/link";
import { headers as requestHeaders } from "next/headers";
import { forwardedHeaders } from "@healthcare/web-session";
import { API_BASE_URL } from "@/lib/api/config";

export const metadata = { title: "Stop outreach messages" };

/**
 * The opt-out link in an outreach email: opening it records the opt-out for that channel without signing in (the
 * token is single-use and bound to the patient and channel). The answer is the same whether or not the link was valid.
 */
export default async function OutreachOptOutPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let recorded = false;
  if (token && /^[A-Za-z0-9_-]{16,200}$/.test(token)) {
    try {
      const response = await fetch(`${API_BASE_URL}/outreach/opt-out`, {
        method: "POST",
        headers: { ...forwardedHeaders(await requestHeaders()), "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      recorded = response.ok && ((await response.json()) as { recorded?: boolean }).recorded === true;
    } catch {
      recorded = false;
    }
  }
  return (
    <>
      <div>
        <h1 className="text-page-lg font-semibold tracking-tight">{recorded ? "You will not get these messages any more" : "This link no longer works"}</h1>
        <p className="text-muted-foreground">
          {recorded
            ? "We have recorded that you do not want outreach messages on this channel. Messages about your own care, appointments and bills are not affected. You can change this any time under Notification settings in MyHealth."
            : "The link may have been used already or has expired. You can change what you receive any time under Notification settings in MyHealth, or tell the clinic."}
        </p>
      </div>
      <Link href="/login" className="text-center text-body font-medium text-primary underline-offset-4 hover:underline">
        Go to MyHealth
      </Link>
    </>
  );
}
