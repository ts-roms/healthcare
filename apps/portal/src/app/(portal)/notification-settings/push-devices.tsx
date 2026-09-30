"use client";

import * as React from "react";
import { BellIcon, BellOffIcon, SendIcon, SmartphoneIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import type { PortalPushStatus } from "@/lib/api/types";
import { bytesToBase64Url, pushMessage, pushSupport, type PushSupport, urlBase64ToUint8Array } from "@/lib/push";
import { pushStatus, registerPushDevice, removePushDevice, sendTestPush } from "./actions";

/**
 * Notifications on this phone or computer, through the browser. Turning them on asks the browser for permission, then
 * registers this device with the clinic; nothing about a patient's care is ever in a notification (it says a message or
 * result is waiting, and MyHealth shows it after sign-in).
 */
export function PushDevices({ initial }: { initial: PortalPushStatus }) {
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
    const env = {
      hasServiceWorker: "serviceWorker" in navigator,
      hasPushManager: "PushManager" in window,
      hasNotification: "Notification" in window,
      permission: "Notification" in window ? Notification.permission : null,
      secure: window.isSecureContext,
    };
    const state = pushSupport(env);
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
        setMessage({ kind: "ok", text: "Notifications are on for this device." });
      } catch {
        setMessage({ kind: "error", text: "We could not turn notifications on in this browser." });
      }
    });

  const turnOff = (id: string) =>
    startTransition(async () => {
      setMessage(null);
      const result = await removePushDevice(id);
      if (!result.ok) return setMessage({ kind: "error", text: pushMessage(result.code, result.message) });
      // This browser stops receiving too.
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
      setMessage(
        result.ok
          ? {
              kind: "ok",
              text:
                result.data.status === "suppressed" ? "A test was not sent: push is switched off in your choices above." : "A test notification is on its way.",
            }
          : { kind: "error", text: pushMessage(result.code, result.message) },
      );
    });

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-labelledby="push-heading">
      <h2 id="push-heading" className="flex items-center gap-2 font-semibold">
        <BellIcon className="size-5" aria-hidden /> Notifications on your devices
      </h2>
      <p className="text-body text-muted-foreground">
        Get a short notice on this phone or computer when something is waiting in MyHealth. It never contains your results or any health details.
      </p>
      {support === "unsupported" ? (
        <p className="text-body text-muted-foreground">
          This browser cannot show notifications here. Try MyHealth in another browser, over a secure address, or keep using text messages and email.
        </p>
      ) : support === "denied" ? (
        <p className="text-body text-warning-foreground">
          Notifications are blocked for this site in your browser. Allow them in the browser&apos;s settings, then come back.
        </p>
      ) : status.thisDeviceId ? (
        <p className="flex items-center gap-2 text-body text-success-foreground">
          <SmartphoneIcon className="size-4" aria-hidden /> Notifications are on for this device.
        </p>
      ) : (
        <Button type="button" className="self-start" onClick={turnOn} disabled={pending}>
          <BellIcon /> {pending ? "Turning on…" : "Turn on notifications on this device"}
        </Button>
      )}
      {status.devices.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2" aria-label="Devices">
            {status.devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <SmartphoneIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">
                    {d.label}
                    {d.id === status.thisDeviceId ? " (this device)" : ""}
                  </span>
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
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`text-body ${message.kind === "error" ? "text-destructive" : "text-success-foreground"}`}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
