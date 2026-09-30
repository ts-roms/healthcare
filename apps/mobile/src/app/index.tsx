import { latestPerTest, type PortalResult, resultDate, resultValue, usualRange } from "@healthcare/domain/portal-results";
import { router } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { ResultMeaning } from "@/components/result-meaning";
import { ErrorState, Loading } from "@/components/screen-states";
import { useSession } from "@/components/session-provider";
import { colors } from "@/components/theme";
import { usePortal } from "@/components/use-portal";

/** Only results the laboratory has released and allows patients to see are listed (the API decides). */
export default function ResultsScreen() {
  const { state } = useSession();
  const results = usePortal<PortalResult[]>("/portal/results");
  if (state.status !== "signed_in") return null;
  // Dates are shown in the patient's clinic's time zone.
  const { timeZone } = state.me;

  if (results.status === "loading") return <Loading label="Loading your results" />;
  if (results.status === "error") return <ErrorState message={results.message} onRetry={results.reload} />;

  const groups = latestPerTest(results.data);
  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={groups}
      keyExtractor={(g) => g.latest.testId}
      refreshControl={<RefreshControl refreshing={results.refreshing} onRefresh={results.reload} />}
      ListHeaderComponent={
        <Text style={styles.intro}>Results appear here after the laboratory releases them. Your doctor will explain what they mean for you.</Text>
      }
      ListEmptyComponent={
        <View style={styles.card}>
          <Text style={styles.name}>No results to show yet</Text>
          <Text style={styles.meta}>
            When the laboratory finishes a test and releases it to you, it will appear here. Some tests are explained by your doctor in person first.
          </Text>
        </View>
      }
      renderItem={({ item: { latest, count } }) => (
        <Pressable
          onPress={() => router.push({ pathname: "/results/[testId]", params: { testId: latest.testId } })}
          accessibilityRole="button"
          accessibilityHint="Shows this test's history"
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
          <View style={styles.row}>
            <Text style={styles.name}>{latest.testName}</Text>
            <Text style={styles.meta}>{resultDate(latest.collectedAt ?? latest.releasedAt, timeZone)}</Text>
          </View>
          <Text style={styles.value}>
            {resultValue(latest)} {latest.unit ? <Text style={styles.unit}>{latest.unit}</Text> : null}
          </Text>
          <ResultMeaning result={latest} />
          <Text style={styles.meta}>
            {usualRange(latest) ?? ""}
            {count > 1 ? ` · ${count} results over time` : ""}
            {latest.corrected ? " · updated by the laboratory" : ""}
            {latest.performingLaboratory ? ` · tested at ${latest.performingLaboratory}` : ""}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  content: { gap: 12, padding: 16 },
  intro: { fontSize: 15, color: colors.mutedForeground },
  card: { gap: 6, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
  pressed: { backgroundColor: colors.muted },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  name: { flexShrink: 1, fontSize: 17, fontWeight: "600", color: colors.foreground },
  value: { fontSize: 22, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] },
  unit: { fontSize: 15, fontWeight: "400", color: colors.mutedForeground },
  meta: { fontSize: 14, color: colors.mutedForeground },
});
