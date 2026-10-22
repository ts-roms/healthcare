import { latestPerTest, type PortalResult, resultDate, resultValue, usualRange } from "@healthcare/domain/portal-results";
import { router } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { ActingBanner } from "@/components/acting-banner";
import { ResultMeaning } from "@/components/result-meaning";
import { ErrorState, Loading } from "@/components/screen-states";
import { useSession } from "@/components/session-provider";
import { colors } from "@/components/theme";
import { usePortal } from "@/components/use-portal";
import type { PortalDependent } from "@/lib/api-types";

/** Only results the laboratory has released and allows patients to see are listed (the API decides). */
export default function ResultsScreen() {
  const { state, acting } = useSession();
  // Everything below is about the person being looked at: the signed-in patient, or someone they act for.
  const scope = acting?.patientId ?? null;
  const results = usePortal<PortalResult[]>("/portal/results", scope);
  const forms = usePortal<{ count: number }>("/portal/forms/count", scope);
  const people = usePortal<PortalDependent[]>("/portal/proxy/dependents");
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
        <View style={styles.header}>
          <ActingBanner />
          {forms.status === "ready" && forms.data.count > 0 ? (
            <Pressable onPress={() => router.push("/forms")} accessibilityRole="button" style={({ pressed }) => [styles.notice, pressed && styles.pressed]}>
              <Text style={styles.noticeTitle}>
                {forms.data.count === 1 ? "A form is waiting for a signature" : `${forms.data.count} forms are waiting for a signature`}
              </Text>
              <Text style={styles.noticeText}>Read and sign it here.</Text>
            </Pressable>
          ) : null}
          {people.status === "ready" && people.data.length > 0 ? (
            <Pressable onPress={() => router.push("/people")} accessibilityRole="button" style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
              <Text style={styles.linkText}>{acting ? "People you can act for" : "Open a child's or family member's MyHealth"}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.intro}>Results appear here after the laboratory releases them. Your doctor will explain what they mean for you.</Text>
        </View>
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
  header: { gap: 12 },
  intro: { fontSize: 15, color: colors.mutedForeground },
  notice: { gap: 2, backgroundColor: colors.warningSubtle, borderRadius: 12, padding: 14 },
  noticeTitle: { fontSize: 16, fontWeight: "600", color: colors.warningForeground },
  noticeText: { fontSize: 14, color: colors.warningForeground },
  link: { borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, backgroundColor: colors.card },
  linkText: { fontSize: 15, fontWeight: "500", color: colors.primary },
  card: { gap: 6, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
  pressed: { backgroundColor: colors.muted },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  name: { flexShrink: 1, fontSize: 17, fontWeight: "600", color: colors.foreground },
  value: { fontSize: 22, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] },
  unit: { fontSize: 15, fontWeight: "400", color: colors.mutedForeground },
  meta: { fontSize: 14, color: colors.mutedForeground },
});
