import * as Notifications from "expo-notifications";
import { Link, Stack } from "expo-router";
import * as Linking from "expo-linking";
import * as React from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Body, Button, Card, ErrorText, Muted, useTheme } from "@/components/ui";
import { hrefFromPushData, portalLink } from "@/lib/links";
import { noticeTime, unreadCount } from "@/lib/notices";
import { useSession } from "@/lib/session";
import { settings } from "@/lib/settings";
import type { Notice } from "@/lib/types";

export default function Inbox() {
  const { api, state, signOut } = useSession();
  const t = useTheme();
  const me = state.status === "signed_in" ? state.me : null;
  const [notices, setNotices] = React.useState<Notice[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [openHref, setOpenHref] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setNotices(await api.get<Notice[]>("/portal/messages"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your notices.");
    }
  }, [api]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // A notice arriving while the app is open, or tapped from the lock screen, refreshes the list; the message itself names
  // no clinical detail, so where it leads is offered as a link to the web MyHealth.
  React.useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => void load());
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      setOpenHref(portalLink(settings.portalUrl, hrefFromPushData(response.notification.request.content.data)));
      void load();
    });
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [load]);

  const markRead = async (notice: Notice) => {
    if (notice.readAt) return;
    setNotices((current) => current?.map((n) => (n.id === notice.id ? { ...n, readAt: new Date().toISOString() } : n)) ?? null);
    await api.post(`/portal/messages/${notice.id}/read`).catch(() => undefined);
  };

  const unread = notices ? unreadCount(notices) : 0;
  return (
    <>
      <Stack.Screen
        options={{
          title: unread > 0 ? `Notices (${unread})` : "Notices",
          headerRight: () => (
            <Link href="/settings" accessibilityLabel="Notification settings" style={{ color: t.primary, fontSize: 16, padding: 8 }}>
              Settings
            </Link>
          ),
        }}
      />
      <FlatList
        data={notices ?? []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={t.primary}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            {me ? <Body>Hello, {me.patient.givenName}.</Body> : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
            {openHref ? <Button title="Open in MyHealth" onPress={() => void Linking.openURL(openHref)} /> : null}
            {settings.portalUrl ? (
              <Button
                title="Visits, results and bills on the MyHealth website"
                variant="secondary"
                onPress={() => void Linking.openURL(settings.portalUrl ?? "")}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={notices ? <Muted>No notices yet. When the clinic has news for you it shows here.</Muted> : null}
        renderItem={({ item }) => (
          <Card>
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel={`${item.readAt ? "" : "Unread. "}${item.subject ?? "Notice"}. ${item.text}`}
              onTouchEnd={() => void markRead(item)}
            >
              <Body style={{ fontWeight: item.readAt ? "400" : "700" }}>{item.subject ?? "Notice"}</Body>
              <Body>{item.text}</Body>
              <Muted>{me ? noticeTime(item.createdAt, me.timeZone) : ""}</Muted>
            </View>
          </Card>
        )}
        ListFooterComponent={
          <View style={{ marginTop: 12 }}>
            <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
          </View>
        }
      />
    </>
  );
}
