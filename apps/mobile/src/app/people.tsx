import { RELATIONSHIP_LABEL } from "@healthcare/domain/proxy-access";
import { router } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { ActingBanner } from "@/components/acting-banner";
import { ErrorState, Loading } from "@/components/screen-states";
import { useSession } from "@/components/session-provider";
import { colors } from "@/components/theme";
import { usePortal } from "@/components/use-portal";
import type { PortalDependent } from "@/lib/api-types";

/**
 * The people this account holder may act for (a child, a family member): access the clinic granted after its own checks.
 * Choosing one shows that person's MyHealth — results and forms to sign — until the holder goes back to their own.
 */
export default function PeopleScreen() {
  const { acting, actFor } = useSession();
  // The list is about the signed-in person's own account, so it never depends on who is being looked at.
  const people = usePortal<PortalDependent[]>("/portal/proxy/dependents");

  if (people.status === "loading") return <Loading label="Loading the people you can act for" />;
  if (people.status === "error") return <ErrorState message={people.message} onRetry={people.reload} />;

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={people.data}
      keyExtractor={(d) => d.grantId}
      refreshControl={<RefreshControl refreshing={people.refreshing} onRefresh={people.reload} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <ActingBanner />
          <Text style={styles.intro}>People whose MyHealth the clinic lets you open, for example your child. Only the clinic can give or end this access.</Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.card}>
          <Text style={styles.name}>Nobody yet</Text>
          <Text style={styles.meta}>If you look after a child or a family member, ask the clinic to give you access to their MyHealth.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.name}>{item.displayName}</Text>
          <Text style={styles.meta}>
            {RELATIONSHIP_LABEL[item.relationship] ?? item.relationship}
            {item.scopes.includes("act") ? "" : " · can look, not make changes"}
          </Text>
          <Pressable
            onPress={() => {
              actFor(item);
              router.replace("/");
            }}
            disabled={acting?.patientId === item.patientId}
            accessibilityRole="button"
            style={[styles.button, acting?.patientId === item.patientId && styles.buttonOff]}
          >
            <Text style={styles.buttonText}>{acting?.patientId === item.patientId ? "Open now" : `Open ${item.displayName.split(" ")[0]}'s MyHealth`}</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  content: { gap: 12, padding: 16 },
  header: { gap: 12 },
  intro: { fontSize: 15, color: colors.mutedForeground },
  card: { gap: 8, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
  name: { fontSize: 17, fontWeight: "600", color: colors.foreground },
  meta: { fontSize: 14, color: colors.mutedForeground },
  button: { alignSelf: "flex-start", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.primary },
  buttonOff: { opacity: 0.5 },
  buttonText: { color: colors.primaryForeground, fontSize: 15, fontWeight: "600" },
});
