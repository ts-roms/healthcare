# MyHealth mobile app (`apps/mobile`)

An Expo (React Native) app for **patients**, tagged `scope:mobile`, `type:app`. It is a client of the same `/api/v1/portal/*` API as the web MyHealth
(`apps/portal`); it has no server of its own and shares no code with the Next.js apps (their session code is server-side). Version 1 is a
**notifications app**: it signs the patient in, receives push notifications, lists the patient's notices and manages the devices that receive
them. Visits, results, bills and the rest stay on the web MyHealth, which the app links to.

## What it does

- **Sign in** with the MyHealth email and password, and the code from an authenticator app when the account uses two-step verification
  (`POST /portal/auth/login`, `/portal/auth/mfa/verify`). First-time activation and password reset stay on the web MyHealth.
- **Notices** (`GET /portal/messages`, `POST /portal/messages/:id/read`): the patient's MyHealth notices, newest first, in the clinic's time
  zone, pull to refresh, refreshed when a push arrives.
- **Notifications on this phone** (`/settings`): asks the phone's permission, registers the phone (`POST /portal/push/mobile-devices`), sends a
  test notice, turns notifications off on this phone or removes another device (up to 5 devices, browsers included).
- **A tapped notification** opens the app and, when it names a page of the web MyHealth, offers **Open in MyHealth**. Only plain relative paths
  are ever followed (`lib/links.ts`); a notification cannot send the patient to another site.
- **Sign out** removes this phone's registration first (best effort), ends the session on the server and clears it here.

## Push

The platform sends to phones through the **Expo push service** (`https://exp.host/--/api/v2/push/send`; `ExpoPushTransport` in
`libs/notification`), which relays to Apple (APNs) and Google (FCM). Sending needs no account; `EXPO_PUSH_ENABLED=true` turns it on
(`EXPO_ACCESS_TOKEN` only if the Expo project uses "enhanced push security"). Without it the app is told push is not offered.

- **One device table.** The app's Expo token is a `push_subscription` row with `kind = 'expo'` (migration `0081`; the token is the
  `endpoint`, there are no browser keys, `device_label` names the phone). The per-account limit of 5 devices, removal, the "notification
  settings" device count, failure counting and the preference rules are the same as for browsers. A token registered by another account moves
  to that account.
- **One sender.** `WebPushSender` delivers a `push` notification to every active device of the account, browsers through Web Push and phones
  through Expo, for whichever the platform has set up. A ticket of `DeviceNotRegistered` drops the device; a service failure is retried; a
  refusal counts toward the 5-failure limit.
- **Content.** Exactly what a browser push carries: a title, one line and a page (`data.url`) — never a result, a name or a reason. The
  same "push first" rule applies (`patient-push.ts`), so a patient with the app gets results-ready, records, dental and message-waiting
  notices there instead of by SMS or email.
- **Not built:** Expo push _receipts_ (Expo reports some failures, notably an uninstalled app, only in receipts fetched later; until then such a
  device stays registered and is dropped after 5 failed sends or removed by the patient), badges and per-notice deep links inside the app.

## Security

- The session (access and refresh token) is kept in the phone's Keychain / Keystore (`expo-secure-store`, this device only, while unlocked),
  never in plain storage. The refresh token rotates; requests that fail together share one refresh (`lib/api.ts`). A refresh the API refuses
  ends the session; being offline does not.
- The API address must be `https://` in release builds (`lib/config.ts`); `http://` is allowed only in development builds.
- The app holds no secret. Its organization, API address and web MyHealth address are public build settings.
- Everything the app can do is what the patient can do in the web MyHealth; the API authorizes every call, re-checking session, account and
  portal consent (`PatientAccessGuard`), and audits it (actor type `patient`). Guardian access (`X-Acting-For`) is not offered in the app yet.

## Build and run

One build serves one organization. Set at build time (public values, inlined by Metro):

| Variable                        | Meaning                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_BASE_URL`      | The API, including the version prefix, e.g. `https://api.example.ph/api/v1`  |
| `EXPO_PUBLIC_ORGANIZATION_CODE` | The organization's code (`organization.code`), as the web MyHealth uses      |
| `EXPO_PUBLIC_PORTAL_URL`        | Optional: the web MyHealth's address, for the "open in MyHealth" links       |
| `EAS_PROJECT_ID`                | The Expo project the push token belongs to (needed to receive notifications) |
| `MYHEALTH_IOS_BUNDLE_ID`        | The organization's own iOS bundle id (defaults to a placeholder)             |
| `MYHEALTH_ANDROID_PACKAGE`      | The organization's own Android application id (defaults to a placeholder)    |
| `MYHEALTH_APP_NAME`             | The name shown under the icon (default "MyHealth")                           |

```bash
pnpm dev:mobile        # Expo dev server; open in Expo Go or a development build
pnpm nx test mobile    # unit tests of src/lib (sign-in, refresh, push flow, links, times)
```

Push on a real phone needs a development or store build made through EAS (`eas build`), an Apple Developer account and, for Android,
the organization's own Firebase project (its FCM credentials uploaded to the Expo project). Expo Go on Android cannot receive remote push.
The app icon, splash image and store listings are the organization's own and are not in the repository. Publishing to the App Store or Google
Play, and the store's privacy declarations, are the organization's to complete (see `docs/security/compliance-dependencies.md`).

## Tests

`src/lib` holds all the logic that is not screen layout and is tested with Vitest without a React Native runtime: the API client (token
refresh, single flight, offline, sign-out), the push flow (permission, registration, refusals, sign-out), settings validation, links,
time formatting. Screens are type-checked and bundled (`expo export`) but have no UI tests. The API side is covered by
`apps/api/test/portal-push-mobile.int.spec.ts` (registration, limits, the database constraint, sending, gone tokens, retries).
