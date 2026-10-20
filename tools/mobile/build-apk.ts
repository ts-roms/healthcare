/**
 * Builds the MyHealth Android app as an APK and places it where MyHealth serves downloads
 * (docs/deployment/mobile-release.md, "Distributing an APK directly").
 *
 *   pnpm mobile:apk                 # build on this machine (needs the Android SDK and a JDK; EAS Build's local mode)
 *   pnpm mobile:apk --cloud         # build on EAS Build's servers and download the APK
 *   pnpm mobile:apk --dry-run       # print what would run, run nothing
 *   pnpm mobile:apk --output path   # somewhere else than apps/portal/public/downloads/myhealth.apk
 *
 * The `apk` profile of apps/mobile/eas.json is a release build distributed outside the store (`buildType: apk`). The
 * organization's identifiers and EAS project come from the shell or apps/mobile/.env.local (MYHEALTH_ANDROID_PACKAGE,
 * EAS_PROJECT_ID, …); eas-cli signs in with the Expo account holding the project. Nothing here holds a key or a secret.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
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
const dryRun = flag("--dry-run");
const output = path.resolve(option("--output") ?? DEFAULT_OUTPUT);

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

function run(command: string, commandArgs: string[], cwd: string): string {
  const shown = `${command} ${commandArgs.join(" ")}`;
  console.log(`\n> ${shown}  (in ${path.relative(ROOT, cwd) || "."})`);
  if (dryRun) return "";
  const result = spawnSync(command, commandArgs, { cwd, stdio: ["inherit", "pipe", "inherit"], shell: process.platform === "win32", encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) fail(`${shown} failed (exit ${result.status ?? "?"})`);
  return result.stdout ?? "";
}

function main() {
  const env = { ...localEnv(), ...process.env } as Record<string, string | undefined>;
  const missing = ["MYHEALTH_ANDROID_PACKAGE", "EAS_PROJECT_ID"].filter((name) => !env[name]?.trim());
  if (missing.length && !dryRun) {
    fail(
      `Set ${missing.join(" and ")} in the shell or apps/mobile/.env.local first: the organization's Android package name and its EAS project ` +
        `(docs/deployment/mobile-release.md, "One-time set-up for an organization"). An APK is signed for one package name and cannot change it later.`,
    );
  }
  if (!cloud && !dryRun) {
    if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) fail("A local build needs the Android SDK: set ANDROID_HOME (or build with --cloud).");
    if (process.platform === "win32") {
      console.warn("EAS local builds are not supported on Windows; use --cloud, or run this from WSL/macOS/Linux with the Android SDK installed.");
    }
  }
  mkdirSync(path.dirname(output), { recursive: true });

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
