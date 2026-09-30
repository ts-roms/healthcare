import { type ReactNode, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "@/components/session-provider";
import { colors } from "@/components/theme";
import { patientMessage } from "@/lib/api-error";
import { session } from "@/lib/session-instance";

/** Sign-in: the password, then — for accounts with two-step verification — the code (as MyHealth on the web). */
export default function SignInScreen() {
  const { state, signedIn } = useSession();
  const [step, setStep] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const notice = state.status === "signed_out" ? state.notice : null;

  async function submitPassword() {
    if (!email.trim() || !password) return setError("Enter your email and password.");
    setPending(true);
    setError(null);
    try {
      const result = await session.signIn(email.trim(), password);
      setPassword("");
      if (result === "code_required") setStep("code");
      else await signedIn();
    } catch (e) {
      setError(patientMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function submitCode() {
    if (code.trim().length < 6) return setError("Enter the 6-digit code from your authenticator app, or a recovery code.");
    setPending(true);
    setError(null);
    try {
      await session.verifyCode(code.trim());
      await signedIn();
    } catch (e) {
      setError(patientMessage(e));
    } finally {
      setPending(false);
    }
  }

  function startOver() {
    setStep("password");
    setCode("");
    setError(null);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title} accessibilityRole="header">
            MyHealth
          </Text>
          {notice && !error ? <Text style={styles.notice}>{notice}</Text> : null}
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          {step === "password" ? (
            <View style={styles.form}>
              <Field label="Email">
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  style={styles.input}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="username"
                  accessibilityLabel="Email"
                />
              </Field>
              <Field label="Password">
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  style={styles.input}
                  secureTextEntry
                  autoComplete="current-password"
                  textContentType="password"
                  accessibilityLabel="Password"
                  onSubmitEditing={() => void submitPassword()}
                />
              </Field>
              <Button label={pending ? "Signing in…" : "Sign in"} disabled={pending} onPress={() => void submitPassword()} />
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.body}>Your password is right. Now enter the 6-digit code from your authenticator app.</Text>
              <Field label="Code" hint="Lost your phone? Enter a recovery code instead, like K7M2P-X9QRT.">
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  style={styles.input}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  accessibilityLabel="Code"
                  onSubmitEditing={() => void submitCode()}
                />
              </Field>
              <Button label={pending ? "Checking…" : "Sign in"} disabled={pending} onPress={() => void submitCode()} />
              <Pressable onPress={startOver} accessibilityRole="button" style={styles.link}>
                <Text style={styles.linkText}>Start over</Text>
              </Pressable>
            </View>
          )}

          <Text style={styles.meta}>Setting up MyHealth for the first time, or forgot your password? Use MyHealth on the web, or ask the clinic.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.meta}>{hint}</Text> : null}
    </View>
  );
}

function Button({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[styles.button, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", gap: 16, padding: 24 },
  title: { fontSize: 28, fontWeight: "700", color: colors.foreground },
  body: { fontSize: 16, color: colors.mutedForeground },
  notice: { fontSize: 15, color: colors.foreground, backgroundColor: colors.muted, borderRadius: 8, padding: 12 },
  error: { fontSize: 15, color: colors.dangerForeground, backgroundColor: colors.dangerSubtle, borderRadius: 8, padding: 12 },
  form: { gap: 16 },
  field: { gap: 6 },
  label: { fontSize: 15, fontWeight: "600", color: colors.foreground },
  input: {
    fontSize: 17,
    color: colors.foreground,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.primaryForeground, fontSize: 17, fontWeight: "600" },
  link: { alignItems: "center", paddingVertical: 8 },
  linkText: { color: colors.primary, fontSize: 16, fontWeight: "500" },
  meta: { fontSize: 14, color: colors.mutedForeground },
});
