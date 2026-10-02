# Mobile app — store release (per organization)

How the MyHealth mobile app (`apps/mobile`) is built and released to the App Store and Google Play. Decisions behind it are
D4 and D13 in [mobile-app.md](../architecture/mobile-app.md):

- **One app per organization.** Each clinic organization has its own store listing, identifiers and name.
- **Published by the organization** under its own Apple Developer and Google Play Console accounts (it is the publisher shown in the stores
  and holds the signing credentials).
- **Built with EAS Build** (Expo's build service), which also submits to the stores.
- **Identifiers are chosen by each organization** — none is in the repository.

Nothing here has been run against Expo's or the stores' services yet: no EAS build or submission exists. What was verified is listed at the end.

## What is in the repository

| File                        | What it holds                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/app.json`      | What every organization's build shares: plugins, orientation, version.                                                                 |
| `apps/mobile/app.config.ts` | Each organization's values, read from the environment (table below); rejects a malformed identifier; never invents one.                |
| `apps/mobile/eas.json`      | Build profiles `development`, `preview`, `production` and the `production` submit profile (validated with eas-cli 24.8's own checker). |
| `apps/mobile/.env.example`  | The same variables for local use (`.env.local`, not committed).                                                                        |

### Per-organization settings (not secrets)

| Variable                        | Example                                | Notes                                                                                                                                                          |
| ------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MYHEALTH_IOS_BUNDLE_ID`        | `ph.example.myhealth`                  | iOS bundle identifier. **Cannot be changed after the first release.** Without it builds refuse to run (`expo prebuild` exits with an error).                   |
| `MYHEALTH_ANDROID_PACKAGE`      | `ph.example.myhealth`                  | Android package name. Same rule.                                                                                                                               |
| `MYHEALTH_APP_NAME`             | `MyHealth`                             | Name under the icon. Defaults to `MyHealth`.                                                                                                                   |
| `MYHEALTH_EXPO_OWNER`           | the platform operator's Expo account   | Which Expo account owns the EAS project: one account for every organization's project (decision in mobile-app.md), so one `EXPO_ACCESS_TOKEN` serves them all. |
| `EAS_PROJECT_ID`                | from `eas init`                        | Links builds to the organization's EAS project; push needs it (§8 of mobile-app.md).                                                                           |
| `EXPO_PUBLIC_API_BASE_URL`      | `https://api.example.ph/api/v1`        | The API the app talks to. Built into the app.                                                                                                                  |
| `EXPO_PUBLIC_ORGANIZATION_CODE` | the organization's `organization.code` | Sent with every sign-in. Built into the app.                                                                                                                   |

`EXPO_PUBLIC_*` values are readable in the app binary; nothing secret belongs in any of these.

The app's URL **scheme** (required by expo-router in every native build) is derived from the organization's identifier —
`ph.example.myhealth` gives `ph.example.myhealth`, underscores become hyphens — so two organizations' apps on one phone never claim the
same one. Nothing links to it yet: which links open the app is D7.

### Build profiles (`eas.json`)

| Profile       | Distribution                       | Use                                                                                                            |
| ------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `development` | internal (registered test devices) | Development build with `expo-dev-client`: device testing, including push (Expo Go cannot receive remote push). |
| `preview`     | internal                           | A release build for testers before submission.                                                                 |
| `production`  | store                              | The build submitted to the stores; build numbers increase automatically.                                       |

Each profile reads the EAS environment of the same name (`development`, `preview`, `production`) from the organization's EAS project, so
test builds can point at a test API and production builds at the production API.

### Versions and platforms

- **Version shown in the stores**: `version` in `app.json` (now `0.0.0`) — set it before the first submission and raise it for each release.
- **Build numbers** (iOS build number, Android version code) are kept by EAS (`appVersionSource: remote`) and increased on every production
  build (`autoIncrement`).
- **Minimum OS**: iOS 16.4 (required by the Expo SDK 57 modules; React Native 0.86 alone needs 15.1) and Android API level 24 / Android 7.0
  (React Native 0.86). Target and compile SDK: Android 36. These come from the installed packages and change with the Expo SDK.
- Phones only on iOS (`supportsTablet: false`), portrait, light appearance on both platforms (on Android through `expo-system-ui`, which
  applies `userInterfaceStyle` even when the phone is in dark mode).

## One-time set-up for an organization

Each step is the organization's (or done with its accounts); none is automated here.

1. **Choose the identifiers and name** (bundle identifier, package name, app name). Identifiers are permanent once released.
2. **Store accounts**: the organization enrolls in the Apple Developer Program and creates a Google Play Console developer account in its own
   name, then creates the app records (App Store Connect, Play Console) with the chosen identifiers.
3. **Expo**: the platform operator's Expo account — one account holds every organization's EAS project (the organization's own accounts are
   the store ones, step 2). From `apps/mobile`, with the variables above set in the shell:
   `npx eas-cli@24 init` creates the EAS project; put its id in `EAS_PROJECT_ID` (with `app.config.ts` it cannot write the id itself).
4. **EAS environment variables**: set the variables above in the project's `development`, `preview` and `production` environments (on
   expo.dev or with `eas env:create`). The ones that identify the project (`EAS_PROJECT_ID`, `MYHEALTH_EXPO_OWNER`, the identifiers) must also be
   set in the shell or CI that runs `eas` (`eas env:pull` writes them to `.env.local`).
5. **Signing credentials**: `eas credentials` (or the first build) creates or uploads the iOS distribution certificate and provisioning
   profile and the Android upload key under the organization's accounts. Keep EAS as the holder, or keep copies in the organization's
   secret store — losing the Android upload key needs Google's key reset process.
6. **Push** (§8 of mobile-app.md): APNs key (iOS) and the organization's Firebase credentials (Android) added to the Expo project;
   `EXPO_PUSH_ENABLED=true` on the API and notification worker.
   - `EXPO_ACCESS_TOKEN` is one value for the whole platform deployment, needed only for projects with "enhanced push security". Because
     every project is under the one Expo account above, one token serves them all; a project created under another account would not be
     served.

## Building and submitting

From `apps/mobile` (eas-cli is not a repository dependency; `eas.json` requires 24.8 or later):

```bash
npx eas-cli@24 build --profile development --platform all   # device testing (install the development build, then `pnpm nx start mobile`)
npx eas-cli@24 build --profile preview --platform all       # testers
npx eas-cli@24 build --profile production --platform all    # store build
npx eas-cli@24 submit --profile production --platform ios   # to App Store Connect (then TestFlight / review)
npx eas-cli@24 submit --profile production --platform android
```

Check Expo's current documentation before the first Android submission: Google Play has required the first upload of a new app to be made by
hand in Play Console.

No CI workflow builds or submits the app; builds are started by a person with access to the organization's Expo project. Automating it
(an `EXPO_TOKEN` per organization in CI) is not decided.

## Before each release

1. Checked through the app on an iPhone and an Android phone (D14; manual until an on-device automation tool is chosen). Required: sign-in
   with and without the two-step code; the results list and a result's history read correctly; push turned on, a test notice arrives and
   tapping it opens the results; push turned off; open the app switcher — the cover, not the results, is shown — and return; a screenshot
   of a result is refused (D11); sign-out. Also worth checking: closing and reopening keeps the patient signed in; the
   clinic disabling MyHealth access signs the phone out.
2. `version` in `app.json` raised; `pnpm nx run-many -t lint typecheck test -p mobile` passes.
3. A `preview` build installed and checked against the organization's test API.
4. `production` build, submit, store review.
5. **API compatibility (open decision, D13):** once installed, old app versions keep calling the API. Changes to the `/api/v1/portal/*`
   endpoints the app uses (auth, `me`, results, push) must keep working for them. There is no minimum-version check in the app or the API
   yet.

## Store listing — the organization's to provide

Not encoded or generated here; each store asks for them and reviews them. Check each store's current requirements.

- **Privacy disclosures** (Apple "App Privacy" details, Google Play "Data safety"). What the app does, from the code:
  - sends the email and password to the organization's API to sign in (not stored on the phone);
  - keeps one sign-in (refresh) token in the phone's secure storage (Keychain/Keystore, this device only); nothing else about the patient
    is stored on the phone;
  - shows the patient's released laboratory results fetched from the organization's API (not stored);
  - when the patient turns on notifications, registers with the organization's API the phone's Expo push token, whether it is iOS or
    Android, and the phone's name as the operating system reports it (up to 60 characters; it can contain the owner's name) so the patient
    can tell their devices apart; notices go through Expo's push service to Apple/Google and carry no health information (a result, name
    or reason is never in a notice);
  - no analytics, advertising or tracking library is among the app's dependencies (`apps/mobile/package.json`).
- **Privacy policy URL** — the organization's own.
- **App review access** — reviewers need to sign in: a test MyHealth account on a test environment with **no real patient data**, and
  notes explaining that accounts are issued by the clinic.
- Description, screenshots, support contact, category and age rating.
- Anything the stores require of health-related apps — to be checked against their current guidelines by the organization.

## Verified in the repository (2026-09-30)

- `app.config.ts`: without identifiers `expo config` shows none and `expo prebuild` exits with an error (no native project, no made-up
  identifier); with them prebuild generates the native project; a malformed identifier is refused; a project id or owner in `app.json` is
  kept.
- `eas.json`: all three build profiles and the submit profile, on both platforms, pass `@expo/eas-json` 24.8 (the validator eas-cli 24.8
  uses), which also rejects a broken copy.
- Every SDK-managed package (including `expo-dev-client`) at the version Expo SDK 57 names, including TypeScript `~6.0.3`, which
  `expo install --check` asks for (the offline comparison against the table in the `expo` package had missed it); iOS and Android bundles
  build. Run `pnpm exec expo install --check` from `apps/mobile` — not the repository root, where no Expo CLI is installed.
- **Not verified:** any EAS build, credential set-up or store submission (no Expo or store accounts, and Expo's services are not reachable
  from the development environment used).
