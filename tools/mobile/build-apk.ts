/**
 * Builds the MyHealth Android app as an APK and places it where MyHealth serves downloads
 * (docs/deployment/mobile-release.md, "Distributing an APK directly").
 *
 *   pnpm mobile:apk                 # Gradle on this machine (Android SDK + JDK), signed with the Android debug key: demo and sideload
 *   pnpm mobile:apk --eas           # EAS Build's local mode with the organization's signing key (macOS, Linux or WSL)
 *   pnpm mobile:apk --cloud         # EAS Build's servers, then download the APK
 *   pnpm mobile:apk --dry-run       # print what would run, run nothing
 *   pnpm mobile:apk --output path   # somewhere else than apps/portal/public/downloads/myhealth.apk
 *   pnpm mobile:apk --from file     # only place an APK built another way
 *   pnpm mobile:apk --package id    # the Android package name for this build instead of MYHEALTH_ANDROID_PACKAGE
 *
 * The Gradle path needs no Expo account: `expo prebuild` generates the Android project (ignored in git) and
 * `gradlew assembleRelease` builds it, signed with the debug key Expo's template uses — fine to install on phones for
 * a demo or a pilot, not a store release and not updatable by a store build. The EAS paths use the `apk` profile of
 * apps/mobile/eas.json (a `preview` release build with `buildType: apk`) and the key EAS holds for the organization.
 * Every path reads the organization's values from the shell or apps/mobile/.env.local: MYHEALTH_ANDROID_PACKAGE (the
 * package name the APK is signed for — permanent), EXPO_PUBLIC_API_BASE_URL and EXPO_PUBLIC_ORGANIZATION_CODE (built
 * into the app), EAS_PROJECT_ID for the EAS paths. Nothing here holds a key or a secret.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, globSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "apps", "mobile");
const DEFAULT_OUTPUT = path.join(ROOT, "apps", "portal", "public", "downloads", "myhealth.apk");
const EAS = ["eas-cli@24"];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const cloud = flag("--cloud");
const eas = cloud || flag("--eas");
const dryRun = flag("--dry-run");
const output = path.resolve(option("--output") ?? DEFAULT_OUTPUT);
const packageName = option("--package");

/** `KEY=value` lines of apps/mobile/.env.local, which eas-cli and app.config.ts read; the shell's values win. */
function localEnv(): Record<string, string> {
  const file = path.join(MOBILE, ".env.local");
  if (!existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trim().startsWith("#")) values[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return values;
}

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

function run(command: string, commandArgs: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const shown = `${command} ${commandArgs.join(" ")}`;
  console.log(`\n> ${shown}  (in ${path.relative(ROOT, cwd) || "."})`);
  if (dryRun) return "";
  const result = spawnSync(command, commandArgs, { cwd, env, stdio: ["inherit", "pipe", "inherit"], shell: process.platform === "win32", encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) fail(`${shown} failed (exit ${result.status ?? "?"})`);
  return result.stdout ?? "";
}

/** The JDK for Gradle: JAVA_HOME, else Android Studio's bundled runtime where it usually is. */
function javaHome(env: Record<string, string | undefined>): string | undefined {
  if (env.JAVA_HOME?.trim()) return env.JAVA_HOME.trim();
  const candidates = [
    "C:\\Program Files\\Android\\Android Studio\\jbr",
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
    `${env.HOME ?? ""}/android-studio/jbr`,
  ];
  return candidates.find((dir) => existsSync(path.join(dir, "bin")));
}

/**
 * On Windows, the Ninja bundled with the SDK's CMake refuses any file path of 260 characters or more, and a build reaches its
 * deepest in a library's generated codegen sources (pnpm's store path plus the codegen folders): a checkout at a long path, such
 * as one with the organization's full name in it, cannot build. Measured first, so that a build that cannot finish never starts.
 */
function checkPathLength(): void {
  if (process.platform !== "win32") return;
  let library: string;
  try {
    // Through pnpm's link to where the package really is (its store path is the long part).
    library = realpathSync(path.join(MOBILE, "node_modules", "react-native-reanimated"));
  } catch {
    return;
  }
  const deepest = path.join(library, "android/build/generated/source/codegen/jni/react/renderer/components/rnreanimated/ComponentDescriptors.cpp");
  if (deepest.length < 258) return;
  fail(
    `This checkout is too deep for a Windows build: Ninja refuses paths of 260 characters or more and the build reaches ${deepest.length} ` +
      `(${deepest}). Check the repository out at a short path such as D:\hc, run pnpm install there and pnpm mobile:apk from it ` +
      `(--output can still point here), or build with --cloud or from WSL.`,
  );
}

/** The `.cxx` and `build` folders React Native libraries write inside their own packages while Gradle builds them. */
function clearNativeBuildState() {
  const packages = ["node_modules/.pnpm/*/node_modules/*/android", "node_modules/.pnpm/*/node_modules/@*/*/android", "apps/mobile/node_modules/*/android"];
  const stale = packages.flatMap((pattern) => globSync([`${pattern}/.cxx`, `${pattern}/build`], { cwd: ROOT }));
  if (stale.length === 0) return;
  console.log(`
> remove ${stale.length} native build folder(s) left by an earlier build`);
  if (dryRun) return;
  for (const dir of stale) rmSync(path.join(ROOT, dir), { recursive: true, force: true });
}

/** Android debug-key build through Expo's generated project: no Expo account, no signing credentials. */
function buildWithGradle(env: Record<string, string | undefined>) {
  const sdk = env.ANDROID_HOME?.trim() || env.ANDROID_SDK_ROOT?.trim();
  if (!sdk && !dryRun) fail("A local build needs the Android SDK: set ANDROID_HOME to it (Android Studio installs one), or build with --cloud.");
  const jdk = javaHome(env);
  if (!jdk && !dryRun) fail("A local build needs a JDK: set JAVA_HOME (Android Studio's 'jbr' folder works).");
  for (const name of ["EXPO_PUBLIC_API_BASE_URL", "EXPO_PUBLIC_ORGANIZATION_CODE"]) {
    if (!env[name]?.trim()) console.warn(`${name} is not set: the app will say it is not set up until a build has it (apps/mobile/.env.local).`);
  }
  const buildEnv = {
    ...localEnv(),
    ...process.env,
    MYHEALTH_ANDROID_PACKAGE: env.MYHEALTH_ANDROID_PACKAGE,
    ANDROID_HOME: sdk ?? "",
    ANDROID_SDK_ROOT: sdk ?? "",
    JAVA_HOME: jdk ?? "",
    CI: "1",
  };
  // The Android project is generated from app.json + app.config.ts (ignored in git) and rebuilt from scratch each time. The native
  // libraries keep CMake state in their own package folders; left over from an earlier build of a project since cleaned, it makes
  // CMake re-run itself forever ("Re-running CMake..."), so it goes first.
  checkPathLength();
  clearNativeBuildState();
  run("npx", ["expo", "prebuild", "--platform", "android", "--clean", "--no-install"], MOBILE, buildEnv);
  const android = path.join(MOBILE, "android");
  // Node spawns a .bat only through cmd.exe, which wants the full path quoted (the checkout may contain spaces).
  const gradlew = process.platform === "win32" ? `"${path.join(android, "gradlew.bat")}"` : "./gradlew";
  run(gradlew, ["assembleRelease", "--no-daemon"], android, buildEnv);
  const built = path.join(android, "app", "build", "outputs", "apk", "release", "app-release.apk");
  if (dryRun) {
    console.log(`\n> copy ${path.relative(ROOT, built)} → ${path.relative(ROOT, output)}`);
    return;
  }
  if (!existsSync(built)) fail(`Gradle finished but ${built} is missing.`);
  copyFileSync(built, output);
  console.warn("\nSigned with the Android debug key: install it on phones for a demo or a pilot; a store build (EAS) cannot update it later.");
}

function main() {
  const env = { ...localEnv(), ...process.env } as Record<string, string | undefined>;
  if (packageName?.trim()) env.MYHEALTH_ANDROID_PACKAGE = packageName.trim();
  if (!env.MYHEALTH_ANDROID_PACKAGE?.trim() && !dryRun) {
    fail(
      "Set MYHEALTH_ANDROID_PACKAGE in the shell or apps/mobile/.env.local, or pass --package: the organization's Android package name, e.g. " +
        "ph.example.myhealth (docs/deployment/mobile-release.md). An APK is signed for one package name and cannot change it later.",
    );
  }
  mkdirSync(path.dirname(output), { recursive: true });

  if (!eas) {
    buildWithGradle(env);
    finish();
    return;
  }
  if (!env.EAS_PROJECT_ID?.trim() && !dryRun) {
    fail(
      "The EAS paths need EAS_PROJECT_ID (and an eas-cli sign-in to the Expo account holding the project); without an EAS project, build without --eas/--cloud.",
    );
  }
  if (!cloud && !dryRun) {
    if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) fail("A local EAS build needs the Android SDK: set ANDROID_HOME (or build with --cloud).");
    if (process.platform === "win32") {
      console.warn("EAS local builds are not supported on Windows; use --cloud, or run this from WSL/macOS/Linux with the Android SDK installed.");
    }
  }

  const common = ["build", "--platform", "android", "--profile", "apk", "--non-interactive"];
  if (cloud) {
    // Build on EAS; wait for it; the answer names the artifact to download.
    const json = run("npx", [...EAS, ...common, "--json", "--wait"], MOBILE);
    if (dryRun) {
      run("curl", ["-L", "<applicationArchiveUrl from the build's JSON>", "-o", output], ROOT);
    } else {
      const builds = JSON.parse(json.trim().replace(/^[^[{]*/, "")) as
        Array<{ artifacts?: { applicationArchiveUrl?: string } }> | { artifacts?: { applicationArchiveUrl?: string } };
      const build = Array.isArray(builds) ? builds[0] : builds;
      const url = build?.artifacts?.applicationArchiveUrl;
      if (!url) fail("EAS answered without an application archive URL; open the build on expo.dev and download the APK by hand.");
      run("curl", ["-fL", url, "-o", output], ROOT);
    }
  } else {
    // Local: EAS Build runs on this machine and writes the APK straight to the output path.
    run("npx", [...EAS, ...common, "--local", "--output", output], MOBILE);
  }
  finish();
}

function finish() {
  if (dryRun) {
    console.log(`\nDry run: nothing was built. The APK would be at ${path.relative(ROOT, output)}.`);
    return;
  }
  if (!existsSync(output)) fail(`The build finished but ${output} is missing.`);
  const size = (statSync(output).size / 1_048_576).toFixed(1);
  console.log(`\nAPK ready: ${path.relative(ROOT, output)} (${size} MB).`);
  if (output === DEFAULT_OUTPUT) {
    console.log("Set MOBILE_APP_ANDROID_URL=/downloads/myhealth.apk on the portal and staff apps and deploy MyHealth: the QR codes then point at it.");
  }
}

// Keep a copy helper for callers that build elsewhere and only want the file placed (`--from <apk>`).
const from = option("--from");
if (from) {
  if (!existsSync(from)) fail(`${from} does not exist`);
  mkdirSync(path.dirname(output), { recursive: true });
  copyFileSync(from, output);
  console.log(`Copied ${from} → ${path.relative(ROOT, output)}`);
} else {
  main();
}
