"use client";

import * as React from "react";
import { BellIcon, BellOffIcon, MonitorSmartphoneIcon, SendIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import type { StaffPushStatus } from "@/lib/api/types";
import { bytesToBase64Url, pushMessage, pushSupport, type PushSupport, urlBase64ToUint8Array } from "@/lib/push";
import { pushStatus, registerPushDevice, removePushDevice, sendTestPush } from "./actions";

/**
 * Notifications in this browser (Web Push). Turning them on asks the browser for permission, then registers it with the
 * platform; a push mirrors an in-app notice with its content-free wording and opens the page it is about.
 */
export function PushDevices({ initial }: { initial: StaffPushStatus }) {
  const [status, setStatus] = React.useState(initial);
  const [support, setSupport] = React.useState<PushSupport>("unsupported");
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const refresh = React.useCallback(async () => {
    const registration = await navigator.serviceWorker?.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    const result = await pushStatus(subscription?.endpoint);
    if (result.ok) setStatus(result.data);
  }, []);

  React.useEffect(() => {
    const state = pushSupport({
      hasServiceWorker: "serviceWorker" in navigator,
      hasPushManager: "PushManager" in window,
      hasNotification: "Notification" in window,
      permission: "Notification" in window ? Notification.permission : null,
      secure: window.isSecureContext,
    });
    const timer = setTimeout(() => {
      setSupport(state);
      if (state !== "unsupported") void refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const turnOn = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setSupport(permission === "denied" ? "denied" : "ready");
          setMessage({ kind: "error", text: "Notifications were not allowed. You can allow them in your browser's settings for this site." });
          return;
        }
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(status.vapidPublicKey ?? "") }));
        const p256dh = subscription.getKey("p256dh");
        const auth = subscription.getKey("auth");
        if (!p256dh || !auth) throw new Error("This browser did not give the keys needed.");
        const result = await registerPushDevice({ endpoint: subscription.endpoint, keys: { p256dh: bytesToBase64Url(p256dh), auth: bytesToBase64Url(auth) } });
        if (!result.ok) {
          setMessage({ kind: "error", text: pushMessage(result.code, result.message) });
          return;
        }
        await refresh();
        setMessage({ kind: "ok", text: "Notifications are on in this browser." });
      } catch {
        setMessage({ kind: "error", text: "Notifications could not be turned on in this browser." });
      }
    });

  const turnOff = (id: string) =>
    startTransition(async () => {
      setMessage(null);
      const result = await removePushDevice(id);
      if (!result.ok) return setMessage({ kind: "error", text: pushMessage(result.code, result.message) });
      if (id === status.thisDeviceId) {
        const registration = await navigator.serviceWorker?.getRegistration("/");
        await (await registration?.pushManager.getSubscription())?.unsubscribe();
      }
      await refresh();
    });

  const test = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await sendTestPush();
      setMessage(result.ok ? { kind: "ok", text: "A test notification is on its way." } : { kind: "error", text: pushMessage(result.code, result.message) });
    });

  if (!status.configured) return null;
  return (
    <Card className="mx-4 mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellIcon aria-hidden className="size-4" /> Notifications in this browser
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-table">
        <p className="text-muted-foreground">
          Get a short notice in this browser when a notification arrives here, even with the app in another tab. It says only what kind of thing is waiting and
          opens the page; never a patient&apos;s name, number or result. Remove a browser you no longer use.
        </p>
        {support === "unsupported" ? (
          <p className="text-muted-foreground">This browser cannot show notifications here (it needs a secure address and a current browser).</p>
        ) : support === "denied" ? (
          <p className="text-warning-foreground">
            Notifications are blocked for this site in your browser. Allow them in the browser&apos;s settings, then come back.
          </p>
        ) : status.thisDeviceId ? (
          <p className="flex items-center gap-2 text-success-foreground">
            <MonitorSmartphoneIcon className="size-4" aria-hidden /> Notifications are on in this browser.
          </p>
        ) : (
          <Button type="button" size="sm" className="self-start" onClick={turnOn} disabled={pending}>
            <BellIcon /> {pending ? "Turning on…" : "Turn on notifications in this browser"}
          </Button>
        )}
        {status.devices.length > 0 ? (
          <>
            <ul className="flex flex-col gap-2" aria-label="Browsers">
              {status.devices.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-md border p-2">
                  <MonitorSmartphoneIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 font-medium">
                    {d.label}
                    {d.id === status.thisDeviceId ? " (this browser)" : ""}
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={() => turnOff(d.id)} disabled={pending}>
                    <BellOffIcon /> Remove
                  </Button>
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={test} disabled={pending}>
              <SendIcon /> Send me a test
            </Button>
          </>
        ) : null}
        {message ? (
          <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-destructive" : "text-success-foreground"}>
            {message.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
