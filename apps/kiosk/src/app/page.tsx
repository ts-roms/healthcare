import { ApiError } from "@healthcare/web-session";
import { KioskApp } from "@/components/kiosk-app";
import { kioskApi } from "@/lib/api";
import { APP_VERSION, PRIVACY_NOTICE } from "@/lib/config";
import type { KioskService } from "@/lib/flow";
import { DEFAULT_TIME_ZONE, localToday } from "@/lib/format";

interface Me {
  device: { id: string; code: string; name: string; status: "active" | "maintenance" | "disabled" };
  facility: { id: string; name: string; timeZone: string };
}

export const dynamic = "force-dynamic";

/** The kiosk's one page. It learns only this kiosk's name, facility and the services it offers: no patient data. */
export default async function KioskPage() {
  let me: Me;
  try {
    me = await kioskApi<Me>("/kiosk/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return (
        <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-8">
          <h1 className="text-3xl font-semibold">This account is not a kiosk</h1>
          <p>
            The account used to set up this screen does not hold the Patient kiosk role at a registered kiosk. Ask an administrator, then sign in again at
            /setup.
          </p>
        </main>
      );
    }
    throw error;
  }

  let services: KioskService[] = [];
  if (me.device.status === "active") {
    try {
      services = (await kioskApi<{ items: KioskService[] }>("/kiosk/services")).items;
    } catch (error) {
      // The services are only choices: a failure still leaves appointment check-in and registration available.
      if (!(error instanceof ApiError)) throw error;
    }
  }

  const timeZone = me.facility.timeZone || DEFAULT_TIME_ZONE;
  return (
    <KioskApp
      facilityName={me.facility.name}
      timeZone={timeZone}
      today={localToday(timeZone)}
      deviceStatus={me.device.status}
      services={services}
      privacyNotice={PRIVACY_NOTICE}
      appVersion={APP_VERSION}
    />
  );
}
