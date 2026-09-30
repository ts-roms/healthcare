import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

export function Loading({ label }: { label: string }) {
  return (
    <View style={styles.center} accessibilityLabel={label}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.message} accessibilityRole="alert">
        {message}
      </Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: colors.background },
  message: { fontSize: 16, color: colors.foreground, textAlign: "center" },
  button: { borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: colors.primary },
  buttonText: { color: colors.primaryForeground, fontSize: 16, fontWeight: "600" },
});
