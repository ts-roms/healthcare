import * as React from "react";
import { ScrollView, View } from "react-native";
import { Body, Button, Card, ErrorText, Heading, Muted } from "@/components/ui";
import { nativePush } from "@/lib/native-push";
import { enableMessage, enablePush, pushState, removeDevice, type PushState } from "@/lib/push";
import { useSession } from "@/lib/session";
import type { PushDevice } from "@/lib/types";

export default function NotificationSettings() {
  const { api } = useSession();
  const [state, setState] = React.useState<PushState | null>(null);
  const [devices, setDevices] = React.useState<PushDevice[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const result = await pushState(api, nativePush);
      setState(result.state);
      setDevices(result.devices);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your notification settings.");
    }
  }, [api]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const turnOn = () =>
    act(async () => {
      const result = await enablePush(api, nativePush);
      if (!result.ok) setError(enableMessage(result));
    });
  const sendTest = () =>
    act(async () => {
      await api.post("/portal/push/test");
      setMessage("A test notice was sent. It should arrive in a moment.");
    });
  const thisDeviceId = state?.kind === "on" ? state.deviceId : null;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Heading>Notifications on this phone</Heading>
      <Muted>
        A notification only tells you that something is waiting in MyHealth, such as a new message or a result. It never shows a result, a name or a reason.
      </Muted>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <Body>{message}</Body> : null}

      {state === null ? null : state.kind === "unavailable" ? (
        <Card>
          <Body>
            {state.reason === "simulator" ? "Notifications work only on a real phone." : "Your clinic has not turned on notifications for the app yet."}
          </Body>
        </Card>
      ) : state.kind === "on" ? (
        <Card>
          <Body>Notifications are on for this phone.</Body>
          <View style={{ gap: 8, marginTop: 8 }}>
            <Button title="Send a test notice" onPress={sendTest} busy={busy} />
            <Button title="Turn off on this phone" variant="danger" onPress={() => act(() => removeDevice(api, state.deviceId))} busy={busy} />
          </View>
        </Card>
      ) : (
        <Card>
          <Body>Notifications are off for this phone.</Body>
          {state.canAsk ? (
            <View style={{ marginTop: 8 }}>
              <Button title="Turn on notifications" onPress={turnOn} busy={busy} />
            </View>
          ) : (
            <Muted>They are blocked for MyHealth in the phone's settings. Turn them on there, then come back.</Muted>
          )}
        </Card>
      )}

      {devices.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Body style={{ fontWeight: "700" }}>Where you get notifications</Body>
          {devices.map((d) => (
            <Card key={d.id}>
              <Body>
                {d.label}
                {d.id === thisDeviceId ? " (this phone)" : ""}
              </Body>
              {d.id === thisDeviceId ? null : <Button title="Remove" variant="secondary" onPress={() => act(() => removeDevice(api, d.id))} busy={busy} />}
            </Card>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
