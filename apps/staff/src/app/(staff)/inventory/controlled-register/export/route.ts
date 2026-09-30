import { apiFile } from "@/lib/api/client";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The register of controlled items as CSV, fetched with the user's session (the API authorizes and audits it). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const pick = (name: string, pattern: RegExp) => {
    const value = params.get(name);
    return value && pattern.test(value) ? value : undefined;
  };
  const from = pick("from", DATE);
  const to = pick("to", DATE);
  if (!from || !to) return new Response("Choose a period.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  const upstream = await apiFile("/inventory/controlled-register/export", {
    accept: "text/csv",
    query: { from, to, itemId: pick("itemId", UUID), locationId: pick("locationId", UUID) },
  });
  if (!upstream.ok) {
    const message = upstream.status === 403 ? "You do not have access to the register." : "The register could not be exported.";
    return new Response(message, { status: upstream.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": upstream.headers.get("content-disposition") ?? 'attachment; filename="controlled-register.csv"',
      "cache-control": "private, no-store",
    },
  });
}
