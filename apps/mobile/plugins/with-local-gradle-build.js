// @ts-check
/**
 * Expo config plugin for a local Gradle build (`pnpm mobile:apk`) from a Windows checkout whose path contains spaces or is long,
 * such as "D:\codespaces\Healthcare Management Platform". Two rewrites of the generated Android project, nothing else:
 *
 * 1. Expo's template sets `react.hermesCommand` to the absolute path of the Hermes compiler. React Native's Gradle plugin runs it
 *    through `cmd /c`, which cuts an absolute path at its first space, so the release build fails at
 *    `createBundleReleaseJsAndAssets`. The same command works with a path relative to the project root (that step's working
 *    directory), so the line is rewritten to one.
 * 2. Each native library (react-native-screens, worklets, …) configures CMake inside its own package folder, under
 *    `node_modules/.pnpm/<name>@<version>_<hash>/node_modules/<name>/android/.cxx/…`: the generated prefab files end up about 300
 *    characters deep, beyond the 260 the Ninja bundled with the SDK's CMake can open, so Ninja sees them as missing and re-runs
 *    CMake until it gives up ("manifest 'build.ninja' still dirty after 100 tries"). The staging folder of every library module is
 *    moved to `android/build/cxx/<module>` (ignored in git, removed by `expo prebuild --clean`), which keeps those paths short. A
 *    library's `build` folder cannot move the same way (their CMake files name `build/generated/...` literally), so the checkout
 *    itself must be at a short path: `pnpm mobile:apk` measures that first and says so.
 *
 * EAS Build is unaffected (its paths are short and hold no spaces); the rewrites are harmless there.
 */
const { withAppBuildGradle, withProjectBuildGradle } = require("expo/config-plugins");

const HERMES_TEMPLATE = /^(\s*hermesCommand = )new File\((.*)\)\.getParentFile\(\)\.getAbsolutePath\(\) \+ "\/hermesc\/%OS-BIN%\/hermesc"/m;

const STAGING_MARKER = "// plugins/with-local-gradle-build.js:";
const STAGING_BLOCK = `
${STAGING_MARKER} short native build paths for every library module (Windows MAX_PATH; see the plugin for why).
subprojects { sub ->
  sub.plugins.withId("com.android.library") {
    sub.android.externalNativeBuild.cmake.buildStagingDirectory = new File(rootProject.projectDir, "build/cxx/" + sub.name)
  }
}
`;

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withLocalGradleBuild = (config) => {
  config = withAppBuildGradle(config, (gradle) => {
    gradle.modResults.contents = gradle.modResults.contents.replace(
      HERMES_TEMPLATE,
      '$1new File(projectRoot).toPath().relativize(new File($2).getParentFile().toPath()).toString() + "/hermesc/%OS-BIN%/hermesc"',
    );
    return gradle;
  });
  return withProjectBuildGradle(config, (gradle) => {
    if (!gradle.modResults.contents.includes(STAGING_MARKER)) gradle.modResults.contents += STAGING_BLOCK;
    return gradle;
  });
};

module.exports = withLocalGradleBuild;
