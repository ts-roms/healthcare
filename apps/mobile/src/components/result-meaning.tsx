import { resultMeaning, type PortalResult, type ResultTone } from "@healthcare/domain/portal-results";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

/** The same tones as MyHealth on the web (apps/portal/src/components/result-meaning.tsx): symbol + words + colour. */
const TONE: Record<ResultTone, { symbol: string; background: string; color: string }> = {
  normal: { symbol: "✓", background: colors.successSubtle, color: colors.successForeground },
  attention: { symbol: "↕", background: colors.warningSubtle, color: colors.warningForeground },
  urgent: { symbol: "!", background: colors.dangerSubtle, color: colors.dangerForeground },
  neutral: { symbol: "–", background: colors.muted, color: colors.mutedForeground },
};

/** Where a value sits against the usual range — never colour alone. */
export function ResultMeaning({ result }: { result: Pick<PortalResult, "flag"> }) {
  const meaning = resultMeaning(result);
  const tone = TONE[meaning.tone];
  return (
    <View style={[styles.badge, { backgroundColor: tone.background }]} accessible accessibilityLabel={meaning.text}>
      <Text style={[styles.symbol, { color: tone.color }]} importantForAccessibility="no" accessibilityElementsHidden>
        {tone.symbol}
      </Text>
      <Text style={[styles.text, { color: tone.color }]}>{meaning.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  symbol: { fontSize: 14, fontWeight: "700" },
  text: { fontSize: 14, fontWeight: "500", flexShrink: 1 },
});
