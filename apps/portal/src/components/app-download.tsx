import { headers } from "next/headers";
import QRCode from "qrcode";
import { AppDownload } from "@healthcare/ui/healthcare";
import { isApk, storeLinks } from "@/lib/mobile-app";

/** "Get the MyHealth app" on the sign-in page: a QR code per configured store listing; nothing until the app is published. */
export async function GetTheApp() {
  // A path in this site's public folder needs the site's address for a scannable link: PORTAL_BASE_URL, else the request's host.
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const origin = process.env.PORTAL_BASE_URL?.trim() || (host ? `${proto}://${host}` : null);
  const links = storeLinks(process.env, origin);
  if (links.length === 0) return null;
  const codes = await Promise.all(
    links.map(async (link) => ({ ...link, svg: await QRCode.toString(link.href, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) })),
  );
  return (
    <AppDownload
      codes={codes}
      title="Get the MyHealth app"
      className="rounded-xl border bg-card p-4"
      note={
        codes.some((c) => isApk(c.href))
          ? "Scan with your phone's camera, or tap the link, to download the Android app; your phone asks to allow installing from this source. The app shows the same records as this site and uses the same account."
          : "Scan with your phone's camera, or tap the link. The app shows the same records as this site and uses the same account."
      }
    />
  );
}
