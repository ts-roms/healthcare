import QRCode from "qrcode";
import { AppDownload } from "@healthcare/ui/healthcare";
import { storeLinks } from "@/lib/mobile-app";

/** "Get the MyHealth app" on the sign-in page: a QR code per configured store listing; nothing until the app is published. */
export async function GetTheApp() {
  const links = storeLinks(process.env);
  if (links.length === 0) return null;
  const codes = await Promise.all(
    links.map(async (link) => ({ ...link, svg: await QRCode.toString(link.href, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) })),
  );
  return (
    <AppDownload
      codes={codes}
      title="Get the MyHealth app"
      className="rounded-xl border bg-card p-4"
      note="Scan with your phone's camera, or tap the link. The app shows the same records as this site and uses the same account."
    />
  );
}
