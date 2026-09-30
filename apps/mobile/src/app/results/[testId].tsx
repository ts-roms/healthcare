import { type PortalTrend, resultDate, resultValue, usualRange } from "@healthcare/domain/portal-results";
import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ResultMeaning } from "@/components/result-meaning";
import { ErrorState, Loading } from "@/components/screen-states";
import { useSession } from "@/components/session-provider";
import { colors } from "@/components/theme";
import { usePortal } from "@/components/use-portal";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One test over time: the latest result and every earlier one with the range it had at the time. */
export default function ResultScreen() {
  const { testId } = useLocalSearchParams<{ testId: string }>();
  if (!testId || !UUID.test(testId)) return <ErrorState message="This result could not be found." />;
  return <Trend testId={testId} />;
}

function Trend({ testId }: { testId: string }) {
  const { state } = useSession();
  const trend = usePortal<PortalTrend>(`/portal/results/trend?testId=${encodeURIComponent(testId)}`);
  if (state.status !== "signed_in") return null;
  const { timeZone } = state.me;

  if (trend.status === "loading") return <Loading label="Loading this result" />;
  if (trend.status === "error") return <ErrorState message={trend.message} onRetry={trend.reload} />;
  const latest = trend.data.points.at(-1);
  if (!latest) return <ErrorState message="This result could not be found." />;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: trend.data.testName }} />
      <View style={styles.card}>
        <Text style={styles.title} accessibilityRole="header">
          {trend.data.testName}
        </Text>
        <Text style={styles.value}>
          {resultValue(latest)} {latest.unit ? <Text style={styles.unit}>{latest.unit}</Text> : null}
        </Text>
        <ResultMeaning result={latest} />
        <Text style={styles.meta}>
          {usualRange(latest) ?? ""} · {resultDate(latest.collectedAt ?? latest.releasedAt, timeZone)}
          {latest.corrected ? " · updated by the laboratory" : ""}
          {latest.performingLaboratory ? ` · tested at ${latest.performingLaboratory}` : ""}
        </Text>
      </View>

      <Text style={styles.section} accessibilityRole="header">
        History
      </Text>
      <View style={styles.card}>
        {[...trend.data.points].reverse().map((p, i) => (
          <View key={p.id} style={[styles.point, i > 0 && styles.divider]}>
            <View style={styles.row}>
              <Text style={styles.pointValue}>
                {resultValue(p)} {p.unit ?? ""}
              </Text>
              <Text style={styles.meta}>{resultDate(p.collectedAt ?? p.releasedAt, timeZone)}</Text>
            </View>
            <ResultMeaning result={p} />
            {usualRange(p) ? <Text style={styles.meta}>{usualRange(p)} (at the time)</Text> : null}
            {p.performingLaboratory ? <Text style={styles.meta}>Tested at {p.performingLaboratory}</Text> : null}
          </View>
        ))}
      </View>
      <Text style={styles.meta}>Questions about a result? Talk to your doctor or contact the clinic. This app does not give medical advice.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { gap: 12, padding: 16 },
  card: { gap: 8, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
  title: { fontSize: 20, fontWeight: "600", color: colors.foreground },
  value: { fontSize: 28, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] },
  unit: { fontSize: 16, fontWeight: "400", color: colors.mutedForeground },
  section: { fontSize: 18, fontWeight: "600", color: colors.foreground, marginTop: 8 },
  point: { gap: 6, paddingVertical: 8 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  pointValue: { fontSize: 17, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] },
  meta: { fontSize: 14, color: colors.mutedForeground },
});
