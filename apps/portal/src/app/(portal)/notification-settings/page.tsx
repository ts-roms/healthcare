import { portalApi } from "@/lib/api/client";
import type { PortalPreferences } from "@/lib/api/types";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Notification settings" };

export default async function NotificationSettingsPage() {
  const preferences = await portalApi<PortalPreferences>("/portal/communication-preferences");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Notification settings</h1>
        <p className="text-body text-muted-foreground">
          Choose which messages the clinic may send you by text message and email. Messages in MyHealth always reach you here. A message never includes test
          names, results or other health details.
        </p>
      </div>
      <SettingsForm initial={preferences} />
    </div>
  );
}
