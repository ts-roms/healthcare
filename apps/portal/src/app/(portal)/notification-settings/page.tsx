import { portalApi } from "@/lib/api/client";
import type { PortalPreferences, PortalPushStatus } from "@/lib/api/types";
import { PushDevices } from "./push-devices";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Notification settings" };

export default async function NotificationSettingsPage() {
  const [preferences, push] = await Promise.all([
    portalApi<PortalPreferences>("/portal/communication-preferences"),
    portalApi<PortalPushStatus>("/portal/push"),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Notification settings</h1>
        <p className="text-body text-muted-foreground">
          Choose which messages the clinic may send you by text message, email and, if you turn it on, notifications on your devices. Messages in MyHealth
          always reach you here. A message never includes test names, results or other health details.
        </p>
      </div>
      <SettingsForm initial={preferences} pushConfigured={push.configured} />
      {push.configured ? <PushDevices initial={push} /> : null}
    </div>
  );
}
