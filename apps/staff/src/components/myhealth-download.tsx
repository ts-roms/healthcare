import QRCode from "qrcode";
import { AppDownload } from "@healthcare/ui/healthcare";
import { downloadLinks, isApk, mobileAppLinks } from "@/lib/mobile-app";

/**
 * The "MyHealth on your phone" block of the landing page: a QR code per configured store link (`MOBILE_APP_IOS_URL`,
 * `MOBILE_APP_ANDROID_URL`), or one to MyHealth on the web (`PORTAL_BASE_URL`) until the app is published. Codes are
 * drawn on the server; nothing is shown when no link is configured.
 */
export async function MyHealthDownload() {
  const links = downloadLinks(mobileAppLinks(process.env));
  if (links.length === 0) return null;
  const codes = await Promise.all(
    links.map(async (link) => ({ ...link, svg: await QRCode.toString(link.href, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) })),
  );
  const stores = codes.some((c) => c.key !== "web");
  const apk = codes.some((c) => isApk(c.href));
  return (
    <section id="myhealth" className="scroll-mt-16 border-b">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-start lg:py-20">
        <div className="max-w-2xl">
          <p className="text-body font-semibold text-primary">For patients</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">MyHealth, on the phone</h2>
          <p className="mt-3 text-section text-muted-foreground">
            Patients see their visits, released results, prescriptions, bills and messages in MyHealth, the patient portal. Point a phone&apos;s camera at the
            code to get it. Accounts are activated at the clinic with a one-time code.
          </p>
        </div>
        <AppDownload
          codes={codes}
          className="rounded-2xl border bg-card p-6"
          note={
            apk
              ? "Scan to download the Android app; the phone asks to allow installing from this source. iPhone users open MyHealth in the browser. The app shows the same records as MyHealth on the web and needs the account the clinic activates."
              : stores
                ? "Scan to open the store listing. The app shows the same records as MyHealth on the web and needs the account the clinic activates."
                : "Scan to open MyHealth in the browser. The MyHealth app will be listed here once your organization publishes it."
          }
        />
      </div>
    </section>
  );
}
