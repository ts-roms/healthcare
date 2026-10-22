import Link from "next/link";
import { ChevronLeftIcon, QrCodeIcon, SunIcon } from "lucide-react";
import QRCode from "qrcode";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalQr } from "@/lib/api/types";

export const metadata = { title: "My QR code" };

/**
 * The patient's own check-in QR code, to show at the front desk. It is drawn here on the server from the key the API returns
 * (read-only: the clinic issues, replaces and revokes it). It holds only a key, never a detail about the patient.
 */
export default async function MyQrPage() {
  const [{ patient }, qr] = await Promise.all([getMe(), portalApi<PortalQr>("/portal/qr")]);
  const svg = qr.payload ? await QRCode.toString(qr.payload, { type: "svg", margin: 2, errorCorrectionLevel: "M" }) : null;
  return (
    <div className="flex flex-col gap-5">
      <Link href="/profile" className="flex items-center gap-1 text-body font-medium text-primary">
        <ChevronLeftIcon className="size-4" aria-hidden /> Profile
      </Link>
      <h1 className="text-page-lg font-semibold">My QR code</h1>
      {svg ? (
        <>
          <section aria-label="Your check-in QR code" className="flex flex-col items-center gap-3 rounded-xl border bg-card p-5 text-center">
            {/* Always dark on white, whatever the theme, so a scanner can read it. */}
            <div
              role="img"
              aria-label="Your check-in QR code. Show it to the staff at the front desk."
              className="size-64 max-w-full rounded-lg bg-white p-2 sm:size-72 [&>svg]:size-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <p className="text-section font-semibold">{patient.displayName}</p>
            <p className="font-mono text-body text-muted-foreground">{qr.patientNumber}</p>
          </section>
          <p className="flex gap-2 text-body text-muted-foreground">
            <QrCodeIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            Show this at the front desk and staff scan it to find your record and check you in. It holds only a key, never your name or any detail, and opens
            nothing by itself.
          </p>
          <p className="flex gap-2 text-body text-muted-foreground">
            <SunIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            Turn your screen brightness up and keep the code in full view. If you lose your phone, tell the clinic: they can replace your code.
          </p>
        </>
      ) : (
        <div role="status" className="flex flex-col gap-2 rounded-xl border bg-card p-5">
          <p className="font-semibold">{qr.enabled ? "Your clinic has not issued a QR code for you yet" : "Your clinic does not use QR codes"}</p>
          <p className="text-body text-muted-foreground">
            {qr.enabled
              ? "Ask at the front desk and they can issue one. You can still check in with your name or patient number."
              : "You can check in with your name or patient number at the front desk."}
          </p>
          <p className="font-mono text-body text-muted-foreground">Patient number: {qr.patientNumber}</p>
        </div>
      )}
    </div>
  );
}
