import QRCode from "qrcode";
import { AppDownload } from "@healthcare/ui/healthcare";
import { downloadLinks, mobileAppLinks } from "@/lib/mobile-app";

/**
 * The "MyHealth on your phone" block of the landing page: a QR code per configured store link (`MOBILE_APP_IOS_URL`,
 * `MOBILE_APP_ANDROID_URL`), or one to MyHealth on the web (`PORTAL_BASE_URL`) until the app is published. Codes are
 * drawn on the server; nothing is shown when no link is configured.
 */
export async function MyHealthDownload({ className }: { className?: string }) {
  const links = downloadLinks(mobileAppLinks(process.env));
  if (links.length === 0) return null;
  const codes = await Promise.all(
    links.map(async (link) => ({ ...link, svg: await QRCode.toString(link.href, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) })),
  );
  const stores = codes.some((c) => c.key !== "web");
  return (
    <AppDownload
      codes={codes}
      className={className}
      note={
        stores
          ? "Scan with the phone's camera to open the store listing. The app shows the same records as MyHealth on the web and needs the account the clinic activates."
          : "Scan with the phone's camera to open MyHealth in the browser. The MyHealth app will be listed here once your organization publishes it."
      }
    />
  );
}
