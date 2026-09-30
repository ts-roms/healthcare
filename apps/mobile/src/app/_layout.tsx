import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Body, Button, useTheme } from "@/components/ui";
import { configureForegroundNotices } from "@/lib/native-push";
import { SessionProvider, useSession } from "@/lib/session";

configureForegroundNotices();

function Routes() {
  const { state, retry } = useSession();
  const t = useTheme();
  if (state.status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.background }}>
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }
  if (state.status === "offline") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: t.background }}>
        <Body>Could not reach MyHealth. You are still signed in.</Body>
        <Button title="Try again" onPress={retry} />
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, contentStyle: { backgroundColor: t.background } }}>
      <Stack.Protected guard={state.status === "signed_in"}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={state.status === "signed_out"}>
        <Stack.Screen name="sign-in" options={{ title: "Sign in", headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <Routes />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
