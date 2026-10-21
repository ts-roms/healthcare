import { apiFile } from "@/lib/api/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The patient card as a PDF, fetched from the API with the user's session; the API authorizes and audits the print. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Unknown patient.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const upstream = await apiFile(`/patient-qr/patients/${id}/card.pdf`);
  if (!upstream.ok) {
    const message =
      upstream.status === 403
        ? "You do not have access to patient cards."
        : upstream.status === 404
          ? "This patient has no active QR code."
          : "The card could not be produced.";
    return new Response(message, { status: upstream.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(upstream.body, {
    headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="patient-card.pdf"', "cache-control": "private, no-store" },
  });
}
