import { RELATIONSHIP_LABEL } from "@healthcare/domain/proxy-access";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "@/components/session-provider";
import { colors } from "@/components/theme";

/** Shown while the signed-in person looks at someone else's MyHealth (guardian access): who it is, and the way back. */
export function ActingBanner() {
  const { acting, stopActing } = useSession();
  if (!acting) return null;
  return (
    <View style={styles.banner} accessibilityRole="summary">
      <Text style={styles.text}>
        You are looking at <Text style={styles.bold}>{acting.displayName}</Text>&apos;s MyHealth as their{" "}
        {(RELATIONSHIP_LABEL[acting.relationship] ?? acting.relationship).toLowerCase()}.{acting.viewOnly ? " You can look but not make changes." : ""}
      </Text>
      <Pressable onPress={stopActing} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.link}>Back to my own MyHealth</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { gap: 6, backgroundColor: colors.warningSubtle, borderRadius: 10, padding: 12 },
  text: { fontSize: 15, color: colors.warningForeground },
  bold: { fontWeight: "700" },
  link: { fontSize: 15, fontWeight: "600", color: colors.primary, textDecorationLine: "underline" },
});
