import { hasEnoughInk, type SignatureStroke } from "@healthcare/domain/signature";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View, Pressable } from "react-native";
import { ActingBanner } from "@/components/acting-banner";
import { ErrorState, Loading } from "@/components/screen-states";
import { SignaturePad } from "@/components/signature-pad";
import { useSession } from "@/components/session-provider";
import { colors } from "@/components/theme";
import { usePortal } from "@/components/use-portal";
import { ApiError, patientMessage, SessionEndedError } from "@/lib/api-error";
import type { PortalForm } from "@/lib/api-types";
import { session } from "@/lib/session-instance";

/**
 * Consent forms the clinic asked the patient — or, for a child, their parent or guardian — to read and sign. Nothing is signed
 * until the signature is drawn, the form is marked as read and the password is entered again (the API checks it).
 */
export default function FormsScreen() {
  const { state, acting } = useSession();
  const forms = usePortal<PortalForm[]>("/portal/forms", acting?.patientId ?? null);
  const [drawing, setDrawing] = useState(false);
  if (state.status !== "signed_in") return null;
  const { timeZone } = state.me;

  if (forms.status === "loading") return <Loading label="Loading your forms" />;
  if (forms.status === "error") return <ErrorState message={forms.message} onRetry={forms.reload} />;

  return (
    <ScrollView
      style={styles.list}
      contentContainerStyle={styles.content}
      scrollEnabled={!drawing}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={forms.refreshing} onRefresh={forms.reload} />}
    >
      <ActingBanner />
      <Text style={styles.intro}>Read each form carefully. Nothing is signed until you draw your signature and send it.</Text>
      {forms.data.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.name}>Nothing to sign</Text>
          <Text style={styles.meta}>When your clinic asks you to sign a form, it appears here.</Text>
        </View>
      ) : (
        forms.data.map((form) => (
          <FormCard
            key={form.id}
            form={form}
            timeZone={timeZone}
            viewOnly={acting?.viewOnly ?? false}
            minorAsSelf={form.representativeRequired && !acting}
            onDrawing={setDrawing}
            onSigned={forms.reload}
          />
        ))
      )}
    </ScrollView>
  );
}

function FormCard({
  form,
  timeZone,
  viewOnly,
  minorAsSelf,
  onDrawing,
  onSigned,
}: {
  form: PortalForm;
  timeZone: string;
  viewOnly: boolean;
  /** The patient is a minor and the signed-in person is looking at their own record: a parent or guardian signs instead. */
  minorAsSelf: boolean;
  onDrawing: (drawing: boolean) => void;
  onSigned: () => void;
}) {
  const [read, setRead] = useState(false);
  const [strokes, setStrokes] = useState<SignatureStroke[]>([]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const ready = read && hasEnoughInk(strokes) && password.length > 0 && !viewOnly && !minorAsSelf;
  const openUntil = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone }).format(new Date(form.expiresAt));

  const send = async () => {
    setError(null);
    setSending(true);
    try {
      await session.post(`/portal/forms/${form.id}/sign`, { password, strokes, understood: true });
      onSigned();
    } catch (e) {
      if (e instanceof SessionEndedError) return;
      setError(
        e instanceof ApiError && e.code === "invalid_credentials"
          ? "The password is not correct."
          : e instanceof ApiError && e.code === "minor_requires_representative"
            ? "This patient is a minor: a parent or guardian signs this form."
            : patientMessage(e),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{form.wording.title}</Text>
      <Text style={styles.meta}>
        {form.procedureName} · {form.facilityName} · open until {openUntil}
      </Text>
      {form.wording.body.split(/\n{2,}/).map((paragraph, i) => (
        <Text key={i} style={styles.body}>
          {paragraph.replace(/\s*\n\s*/g, " ")}
        </Text>
      ))}
      {minorAsSelf ? (
        <Text style={styles.notice}>This patient is a minor, so a parent or guardian signs. Open the child&apos;s MyHealth under People and sign there.</Text>
      ) : null}
      {viewOnly ? <Text style={styles.notice}>You can look at this form but not sign it. Ask the clinic if you need more access.</Text> : null}
      <View style={styles.row}>
        <Switch value={read} onValueChange={setRead} accessibilityLabel="I have read this form and I agree to it" />
        <Text style={styles.body}>I have read this form and I agree to it.</Text>
      </View>
      <Text style={styles.label}>Your signature</Text>
      <SignaturePad onChange={setStrokes} onDrawing={onDrawing} disabled={sending || viewOnly || minorAsSelf} />
      <Text style={styles.label}>Your password, to confirm it is you</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Your password"
      />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Pressable onPress={send} disabled={!ready || sending} accessibilityRole="button" style={[styles.button, (!ready || sending) && styles.buttonOff]}>
        <Text style={styles.buttonText}>{sending ? "Sending…" : "Sign and send"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  content: { gap: 12, padding: 16 },
  intro: { fontSize: 15, color: colors.mutedForeground },
  card: { gap: 10, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
  name: { fontSize: 18, fontWeight: "600", color: colors.foreground },
  meta: { fontSize: 14, color: colors.mutedForeground },
  body: { flexShrink: 1, fontSize: 16, color: colors.foreground },
  notice: { fontSize: 14, color: colors.warningForeground, backgroundColor: colors.warningSubtle, borderRadius: 8, padding: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { fontSize: 15, fontWeight: "600", color: colors.foreground },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.foreground },
  error: { fontSize: 15, color: colors.dangerForeground },
  button: { alignSelf: "flex-start", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: colors.primary },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: colors.primaryForeground, fontSize: 16, fontWeight: "600" },
});
