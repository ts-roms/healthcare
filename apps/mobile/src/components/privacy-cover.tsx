import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { preventScreenCapture } from "@/lib/native-screen-capture";
import { shouldCover } from "@/lib/screen-protection";
import { colors } from "./theme";

/**
 * Covers every screen while the app is not in the foreground (D11): iOS takes its app-switcher snapshot once the app
 * reports `inactive`, so the switcher shows this cover and not the patient's results; `preventScreenCapture` adds the
 * platform's own capture protection (Android recents preview, screenshots, recording). Shows no patient data.
 */
export function PrivacyCover() {
  const [covered, setCovered] = useState(() => shouldCover(AppState.currentState));
  useEffect(() => {
    void preventScreenCapture();
    const subscription = AppState.addEventListener("change", (state) => setCovered(shouldCover(state)));
    return () => subscription.remove();
  }, []);
  if (!covered) return null;
  return (
    <View style={styles.cover} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <Text style={styles.name}>MyHealth</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    elevation: 1000,
  },
  name: { color: colors.primaryForeground, fontSize: 28, fontWeight: "600" },
});
