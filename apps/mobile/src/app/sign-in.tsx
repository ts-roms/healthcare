import * as React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Button, ErrorText, Heading, Muted, useTheme } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { signInMessage } from "@/lib/messages";
import { useSession } from "@/lib/session";
import { settings } from "@/lib/settings";

export default function SignIn() {
  const { api, completeSignIn } = useSession();
  const t = useTheme();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [challenge, setChallenge] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof ApiError ? signInMessage(e.code, e.message) : e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = () =>
    run(async () => {
      const result = await api.login(email, password);
      if (result.kind === "mfa_required") setChallenge(result.challengeToken);
      else await completeSignIn();
    });
  const submitCode = () =>
    run(async () => {
      await api.verifyMfa(challenge ?? "", code);
      await completeSignIn();
    });

  const input = {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.card,
    color: t.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 16,
  } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 16, flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
          <Heading>MyHealth</Heading>
          {challenge === null ? (
            <>
              <Muted>Sign in with the email and password of your MyHealth account.</Muted>
              <View style={{ gap: 6 }}>
                <Body>Email</Body>
                <TextInput
                  accessibilityLabel="Email"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  inputMode="email"
                  keyboardType="email-address"
                  textContentType="username"
                  value={email}
                  onChangeText={setEmail}
                  style={input}
                />
              </View>
              <View style={{ gap: 6 }}>
                <Body>Password</Body>
                <TextInput
                  accessibilityLabel="Password"
                  autoCapitalize="none"
                  autoComplete="current-password"
                  secureTextEntry
                  textContentType="password"
                  value={password}
                  onChangeText={setPassword}
                  onSubmitEditing={submitPassword}
                  style={input}
                />
              </View>
              {error ? <ErrorText>{error}</ErrorText> : null}
              <Button title="Sign in" onPress={submitPassword} busy={busy} disabled={!email.trim() || !password} />
              <Muted>
                First time? Ask the clinic for an activation code and activate your account on the MyHealth website
                {settings.portalUrl ? ` (${settings.portalUrl})` : ""}. Forgot your password? Use “Forgot password” there.
              </Muted>
            </>
          ) : (
            <>
              <Muted>Enter the 6-digit code from your authenticator app, or a recovery code.</Muted>
              <View style={{ gap: 6 }}>
                <Body>Code</Body>
                <TextInput
                  accessibilityLabel="Verification code"
                  autoCapitalize="none"
                  autoComplete="one-time-code"
                  autoCorrect={false}
                  inputMode="numeric"
                  textContentType="oneTimeCode"
                  value={code}
                  onChangeText={setCode}
                  onSubmitEditing={submitCode}
                  style={input}
                />
              </View>
              {error ? <ErrorText>{error}</ErrorText> : null}
              <Button title="Verify" onPress={submitCode} busy={busy} disabled={code.trim().length < 6} />
              <Button
                title="Back"
                variant="secondary"
                onPress={() => {
                  setChallenge(null);
                  setCode("");
                  setError(null);
                }}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
