import { CameraView, useCameraPermissions } from "expo-camera";
import { type ReactNode, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "@/components/session-provider";
import { colors } from "@/components/theme";
import { patientMessage } from "@/lib/api-error";
import { cardKeyFromScan } from "@/lib/card-link";
import { session } from "@/lib/session-instance";

/**
 * First-time set-up with the clinic card: scan its QR code (or type the patient number), enter the date of birth and the
 * one-time activation code the clinic gave you, then choose your own email and password. The card alone opens nothing:
 * the API still checks the date of birth and the code (as MyHealth on the web does).
 */
export default function ActivateScreen() {
  const { signedIn } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [card, setCard] = useState<{ patientNumber: string; givenName: string; birthDate: string; email: string | null } | null>(null);
  const [patientNumber, setPatientNumber] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // One scan at a time: the camera reports the same code many times a second.
  const handling = useRef(false);

  async function startScan() {
    setError(null);
    const granted = permission?.granted || (await requestPermission()).granted;
    if (!granted) return setError("Allow the camera to scan your card, or type your patient number below.");
    setScanning(true);
  }

  async function onScanned(data: string) {
    if (handling.current) return;
    const key = cardKeyFromScan(data);
    if (!key) return; // not a MyHealth card: keep looking
    handling.current = true;
    setScanning(false);
    setPending(true);
    try {
      const found = await session.activationCard(key);
      setCard(found);
      setPatientNumber(found.patientNumber);
      setBirthDate(found.birthDate);
      if (found.email) setEmail(found.email);
    } catch {
      setError("This card could not be used. Type your patient number below, or ask the clinic to invite you again.");
    } finally {
      setPending(false);
      handling.current = false;
    }
  }

  async function submit() {
    if (!patientNumber.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate.trim())) return setError("Enter your patient number and date of birth (YYYY-MM-DD).");
    if (activationCode.replace(/[\s-]/g, "").length < 10) return setError("Enter the activation code from the clinic.");
    if (!email.trim()) return setError("Enter your email.");
    if (password.length < 12) return setError("Choose a password of at least 12 characters. A short phrase is easy to remember.");
    if (password !== confirm) return setError("The two passwords are not the same.");
    setPending(true);
    setError(null);
    try {
      await session.activate({
        patientNumber: patientNumber.trim().toUpperCase(),
        birthDate: birthDate.trim(),
        activationCode: activationCode.replace(/[\s-]+/g, "").toUpperCase(),
        email: email.trim(),
        password,
      });
      setPassword("");
      setConfirm("");
      await signedIn();
    } catch (e) {
      setError(patientMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.body}>
            Use the activation code the clinic gave you. We check it against your patient number and date of birth, so only you can open your record.
          </Text>
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          {scanning ? (
            <View style={styles.cameraBox}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => void onScanned(data)}
                accessibilityLabel="Camera: point it at the QR code on your clinic card"
              />
              <Pressable onPress={() => setScanning(false)} accessibilityRole="button" style={styles.link}>
                <Text style={styles.linkText}>Stop the camera</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => void startScan()} disabled={pending} accessibilityRole="button" style={[styles.secondary, pending && styles.disabled]}>
              <Text style={styles.secondaryText}>{card ? "Scan the card again" : "Scan the QR code on your card"}</Text>
            </Pressable>
          )}

          {card ? (
            <Text style={styles.notice} accessibilityRole="summary">
              Hello, {card.givenName}. Your card is for patient number {card.patientNumber}.
            </Text>
          ) : null}

          <View style={styles.form}>
            <Field label="Patient number" hint="Printed on your clinic card or receipt.">
              <TextInput
                value={patientNumber}
                onChangeText={setPatientNumber}
                editable={!card}
                style={[styles.input, card && styles.inputLocked]}
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel="Patient number"
              />
            </Field>
            <Field label="Date of birth" hint="Year-month-day, e.g. 1985-06-15.">
              <TextInput
                value={birthDate}
                onChangeText={setBirthDate}
                style={styles.input}
                keyboardType="numbers-and-punctuation"
                placeholder="YYYY-MM-DD"
                accessibilityLabel="Date of birth"
              />
            </Field>
            <Field label="Activation code" hint="10 letters and numbers, e.g. ABCDE-23456.">
              <TextInput
                value={activationCode}
                onChangeText={setActivationCode}
                style={styles.input}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="one-time-code"
                accessibilityLabel="Activation code"
              />
            </Field>
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
            <Field label="New password" hint="At least 12 characters.">
              <TextInput
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                accessibilityLabel="New password"
              />
            </Field>
            <Field label="Type the password again">
              <TextInput
                value={confirm}
                onChangeText={setConfirm}
                style={styles.input}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                accessibilityLabel="Type the password again"
                onSubmitEditing={() => void submit()}
              />
            </Field>
            <Pressable
              onPress={() => void submit()}
              disabled={pending}
              accessibilityRole="button"
              accessibilityState={{ disabled: pending }}
              style={[styles.button, pending && styles.disabled]}
            >
              <Text style={styles.buttonText}>{pending ? "Please wait…" : "Set up and sign in"}</Text>
            </Pressable>
          </View>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { gap: 16, padding: 24 },
  body: { fontSize: 16, color: colors.mutedForeground },
  notice: { fontSize: 15, color: colors.foreground, backgroundColor: colors.muted, borderRadius: 8, padding: 12 },
  error: { fontSize: 15, color: colors.dangerForeground, backgroundColor: colors.dangerSubtle, borderRadius: 8, padding: 12 },
  cameraBox: { gap: 8 },
  camera: { height: 300, borderRadius: 12, overflow: "hidden" },
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
  inputLocked: { backgroundColor: colors.muted },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: colors.primaryForeground, fontSize: 17, fontWeight: "600" },
  secondary: { borderColor: colors.primary, borderWidth: 1, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  secondaryText: { color: colors.primary, fontSize: 17, fontWeight: "600" },
  disabled: { opacity: 0.6 },
  link: { alignItems: "center", paddingVertical: 8 },
  linkText: { color: colors.primary, fontSize: 16, fontWeight: "500" },
  meta: { fontSize: 14, color: colors.mutedForeground },
});
