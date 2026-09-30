import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * One store app per organization (docs/deployment/mobile-release.md, D4 and D13 in docs/architecture/mobile-app.md): app.json holds
 * what every build shares; each organization's values come from the environment — locally from apps/mobile/.env.local, in EAS
 * Build from that organization's EAS project (environment variables per build profile). Nothing here is a secret.
 *
 * Environment values win over app.json; nothing set in app.json is dropped. There is deliberately no default identifier: without
 * MYHEALTH_IOS_BUNDLE_ID / MYHEALTH_ANDROID_PACKAGE (or one in app.json), `expo start` (Expo Go)
 * still works, but EAS Build and `expo prebuild` refuse to build — an identifier cannot be changed after a store release, so a
 * build must never go out under a made-up one.
 */

/** Reverse-domain form both stores accept, e.g. ph.example.myhealth: 2+ segments of letters, digits and underscores, each starting with a letter. */
const APP_ID = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

function identifier(name: "MYHEALTH_IOS_BUNDLE_ID" | "MYHEALTH_ANDROID_PACKAGE", fromAppJson: string | undefined): string | undefined {
  const value = process.env[name]?.trim() || fromAppJson;
  if (!value) return undefined;
  if (!APP_ID.test(value)) throw new Error(`${name} "${value}" is not a reverse-domain identifier such as ph.example.myhealth`);
  return value;
}

/**
 * The app's own URL scheme, which expo-router needs in every native build (without one a build may crash). One app per organization
 * (D4) means one scheme per organization, so it is derived from that app's identifier — unique per app — rather than a shared word
 * that two clinics' apps on one phone would both claim: `ph.example.myhealth` → `ph.example.myhealth`, underscores become hyphens
 * (not allowed in a scheme). Which links, if any, open the app is still undecided (D7); no link uses the scheme yet.
 */
function schemeFrom(appId: string | undefined, slug: string): string {
  return (appId ?? slug).toLowerCase().replaceAll("_", "-");
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosBundleId = identifier("MYHEALTH_IOS_BUNDLE_ID", config.ios?.bundleIdentifier);
  const androidPackage = identifier("MYHEALTH_ANDROID_PACKAGE", config.android?.package);
  const slug = config.slug ?? "healthcare-myhealth";
  return {
    ...config,
    name: optional("MYHEALTH_APP_NAME") ?? config.name ?? "MyHealth",
    slug,
    // Without an identifier (Expo Go, local development) the slug; builds need identifiers anyway.
    scheme: config.scheme ?? schemeFrom(androidPackage ?? iosBundleId, slug),
    // The organization's Expo account (EAS projects belong to an account); unset: the signed-in Expo user.
    owner: optional("MYHEALTH_EXPO_OWNER") ?? config.owner,
    ios: { ...config.ios, bundleIdentifier: iosBundleId },
    android: { ...config.android, package: androidPackage },
    // EAS_PROJECT_ID, or a project id already in app.json (never dropped: without it the app cannot receive push).
    extra: { ...config.extra, eas: { ...config.extra?.["eas"], projectId: optional("EAS_PROJECT_ID") ?? config.extra?.["eas"]?.projectId } },
  };
};
