import * as React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useColorScheme, View, type TextStyle, type ViewStyle } from "react-native";

/** Small shared pieces: colours follow the phone's light/dark setting; touch targets are at least 44 points. */
export function useTheme() {
  const dark = useColorScheme() === "dark";
  return {
    dark,
    background: dark ? "#0b1220" : "#f8fafc",
    card: dark ? "#111a2e" : "#ffffff",
    border: dark ? "#24304a" : "#e2e8f0",
    text: dark ? "#f1f5f9" : "#0f172a",
    muted: dark ? "#94a3b8" : "#475569",
    primary: dark ? "#2dd4bf" : "#0f766e",
    onPrimary: dark ? "#042f2e" : "#ffffff",
    danger: dark ? "#f87171" : "#b91c1c",
  };
}

export function Body({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const t = useTheme();
  return <Text style={[{ color: t.text, fontSize: 16, lineHeight: 22 }, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const t = useTheme();
  return <Text style={[{ color: t.muted, fontSize: 14, lineHeight: 20 }, style]}>{children}</Text>;
}

export function Heading({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: t.text, fontSize: 22, fontWeight: "700" }}>
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View style={[{ backgroundColor: t.card, borderColor: t.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16, gap: 6 }, style]}>
      {children}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  busy = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  busy?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  const bg = variant === "primary" ? t.primary : "transparent";
  const fg = variant === "primary" ? t.onPrimary : variant === "danger" ? t.danger : t.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: 10,
        paddingHorizontal: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        borderWidth: variant === "primary" ? 0 : 1,
        borderColor: fg,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 16, fontWeight: "600" }}>{title}</Text>}
    </Pressable>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14 }}>
      {children}
    </Text>
  );
}
