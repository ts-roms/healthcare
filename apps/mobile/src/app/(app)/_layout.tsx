import { Stack } from "expo-router";
import { useTheme } from "@/components/ui";

export default function AppLayout() {
  const t = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, contentStyle: { backgroundColor: t.background } }}>
      <Stack.Screen name="index" options={{ title: "Notices" }} />
      <Stack.Screen name="settings" options={{ title: "Notifications" }} />
    </Stack>
  );
}
