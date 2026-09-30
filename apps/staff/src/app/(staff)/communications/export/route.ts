import { apiFile } from "@/lib/api/client";
import { communicationApiQuery, readCommunicationFilters } from "@/lib/communications";
import { todayInManila } from "@/lib/consent-form";

/** The communication log as CSV, fetched with the user's session (the API authorizes and audits it). */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { filters } = readCommunicationFilters(params, todayInManila());
  const { page: _page, pageSize: _size, ...query } = communicationApiQuery(filters);
  const upstream = await apiFile("/communications/export", { accept: "text/csv", query });
  if (!upstream.ok) {
    const message = upstream.status === 403 ? "You do not have access to the communication log." : "The communication log could not be exported.";
    return new Response(message, { status: upstream.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": upstream.headers.get("content-disposition") ?? 'attachment; filename="communications.csv"',
      "cache-control": "private, no-store",
    },
  });
}
