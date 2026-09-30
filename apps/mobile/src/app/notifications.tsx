import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "@/components/theme";
import { patientMessage } from "@/lib/api-error";
import type { PushDevice } from "@/lib/api-types";
import { nativePush } from "@/lib/native-push";
import { enableMessage, enablePush, pushState, removeDevice, type PushState } from "@/lib/push";
import { session } from "@/lib/session-instance";

/**
 * Notifications on this phone (docs/architecture/mobile-app.md, "Push"). A notification only says that something is
 * waiting in MyHealth; the API decides what is sent and to which devices, and the patient's notification settings apply.
 */
export default function NotificationsScreen() {
  const [state, setState] = useState<PushState | null>(null);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await pushState(session, nativePush);
      setState(result.state);
      setDevices(result.devices);
    } catch (e) {
      setError(patientMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      await load();
    } catch (e) {
      setError(patientMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const turnOn = () =>
    act(async () => {
      const result = await enablePush(session, nativePush);
      if (!result.ok) setError(enableMessage(result));
    });
  const sendTest = () =>
    act(async () => {
      await session.post("/portal/push/test");
      setNotice("A test notification was sent. It should arrive in a moment.");
    });
  const thisDeviceId = state?.kind === "on" ? state.deviceId : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        A notification only tells you that something is waiting in MyHealth, such as a new result or message. It never shows a result, a name or a reason. With
        notifications on here, you get them instead of a text message or email.
      </Text>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {notice ? <Text style={styles.body}>{notice}</Text> : null}

      {state === null ? null : state.kind === "unavailable" ? (
        <View style={styles.card}>
          <Text style={styles.body}>
            {state.reason === "simulator" ? "Notifications work only on a real phone." : "Your clinic has not turned on notifications for the app yet."}
          </Text>
        </View>
      ) : state.kind === "on" ? (
        <View style={styles.card}>
          <Text style={styles.title}>Notifications are on for this phone</Text>
          <Button title="Send a test notification" onPress={sendTest} disabled={busy} />
          <Button title="Turn off on this phone" onPress={() => act(() => removeDevice(session, state.deviceId))} disabled={busy} variant="danger" />
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.title}>Notifications are off for this phone</Text>
          {state.canAsk ? (
            <Button title="Turn on notifications" onPress={turnOn} disabled={busy} />
          ) : (
            <Text style={styles.meta}>They are blocked for MyHealth in the phone&apos;s settings. Turn them on there, then come back.</Text>
          )}
        </View>
      )}

      {devices.length > 0 ? (
        <View style={styles.devices}>
          <Text style={styles.title}>Where you get notifications</Text>
          {devices.map((d) => (
            <View key={d.id} style={styles.card}>
              <Text style={styles.body}>
                {d.label}
                {d.id === thisDeviceId ? " (this phone)" : ""}
              </Text>
              {d.id === thisDeviceId ? null : (
                <Button title="Remove" onPress={() => act(() => removeDevice(session, d.id))} disabled={busy} variant="secondary" />
              )}
            </View>
          ))}
          <Text style={styles.meta}>
            Up to 5 devices, browsers included. Choose which kinds of message you get under Notification settings in MyHealth on the web.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Button({
  title,
  onPress,
  disabled,
  variant = "primary",
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  const primary = variant === "primary";
  const tint = variant === "danger" ? colors.dangerForeground : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        primary ? { backgroundColor: colors.primary } : { borderWidth: 1, borderColor: tint },
        (pressed || disabled) && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? colors.primaryForeground : tint }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: 16, padding: 16 },
  intro: { fontSize: 15, color: colors.mutedForeground },
  card: { gap: 10, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
  devices: { gap: 10 },
  title: { fontSize: 17, fontWeight: "600", color: colors.foreground },
  body: { fontSize: 16, color: colors.foreground },
  meta: { fontSize: 14, color: colors.mutedForeground },
  error: { fontSize: 15, color: colors.dangerForeground },
  button: { minHeight: 48, borderRadius: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 16, fontWeight: "600" },
});
