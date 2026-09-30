import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Pressable, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorState, Loading } from "@/components/screen-states";
import { SessionProvider, useSession } from "@/components/session-provider";
import { colors } from "@/components/theme";
import { configured } from "@/lib/config";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
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
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.primary, headerTitleStyle: { color: colors.foreground } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: "Your results", headerRight: () => <SignOutButton /> }} />
        <Stack.Screen name="results/[testId]" options={{ title: "Result", headerBackTitle: "Results" }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
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
