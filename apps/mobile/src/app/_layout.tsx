import { router, Stack } from "expo-router";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PrivacyCover } from "@/components/privacy-cover";
import { ErrorState, Loading } from "@/components/screen-states";
import { SessionProvider, useSession } from "@/components/session-provider";
import { colors } from "@/components/theme";
import { configured } from "@/lib/config";
import { configureForegroundNotices, notifications, pushAvailable } from "@/lib/native-push";

configureForegroundNotices();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <PrivacyCover />
      {configured ? (
        <SessionProvider>
          <Screens />
        </SessionProvider>
      ) : (
        <ErrorState message="This build of MyHealth is not set up yet (EXPO_PUBLIC_API_BASE_URL and EXPO_PUBLIC_ORGANIZATION_CODE)." />
      )}
    </SafeAreaProvider>
  );
}

/** Signed-in screens exist only with a session; sign-in only without one. */
function Screens() {
  const { state, retry } = useSession();
  if (state.status === "starting") return <Loading label="Opening MyHealth" />;
  if (state.status === "unavailable") return <ErrorState message={state.message} onRetry={retry} />;
  const signedIn = state.status === "signed_in";
  return (
    <>
      {pushAvailable ? <OpenFromNotification signedIn={signedIn} /> : null}
      <Stack screenOptions={{ headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.primary, headerTitleStyle: { color: colors.foreground } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" options={{ title: "Your results", headerRight: () => <HeaderButtons /> }} />
          <Stack.Screen name="results/[testId]" options={{ title: "Result", headerBackTitle: "Results" }} />
          <Stack.Screen name="notifications" options={{ title: "Notifications", headerBackTitle: "Results" }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

/**
 * Mounted only outside Expo Go (`pushAvailable`), where `expo-notifications` can be loaded.
 * Tapping a notification opens the app. A notice names a page of MyHealth on the web (`data.url`); the app shows only
 * results, so it opens the results list for a results notice and stays where it is for anything else.
 */
function OpenFromNotification({ signedIn }: { signedIn: boolean }) {
  const response = notifications().useLastNotificationResponse();
  useEffect(() => {
    if (!signedIn || !response) return;
    const url = response.notification.request.content.data?.["url"];
    if (typeof url === "string" && url.startsWith("/results")) router.navigate("/");
  }, [response, signedIn]);
  return null;
}

function HeaderButtons() {
  return (
    <View style={{ flexDirection: "row", gap: 16 }}>
      <Pressable onPress={() => router.push("/notifications")} accessibilityRole="button" accessibilityLabel="Notifications on this phone" hitSlop={8}>
        <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "500" }}>Notifications</Text>
      </Pressable>
      <SignOutButton />
    </View>
  );
}

function SignOutButton() {
  const { signOut } = useSession();
  return (
    <Pressable onPress={() => void signOut()} accessibilityRole="button" hitSlop={8}>
      <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "500" }}>Sign out</Text>
    </Pressable>
  );
}
