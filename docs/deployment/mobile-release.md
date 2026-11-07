# Mobile app — store release (moved)

The MyHealth mobile app is its own project, `myhealth-mobile`, since v1.1.0, and its store release runbook moved with it: `docs/mobile-release.md`
in that project (one store app per organization, built and submitted with EAS, identifiers chosen by each organization, the release checklist and
store listing inputs).

What changed on the way: an APK for direct distribution is now always a release build signed by EAS with the organization's own key
(`pnpm build:apk` there); the local Gradle build signed with Expo's public template debug key, the `pnpm mobile:apk` script and the APK committed
under `apps/portal/public/downloads/` are gone (zero-trust finding F4, [report](../security/zero-trust-audit-2026-11-06.md)). No APK is kept in
either repository.

What stays in this repository and its deployment:

- `MOBILE_APP_IOS_URL` and `MOBILE_APP_ANDROID_URL` on the `portal` and `staff` services: the store listings, or for Android an https link to the
  EAS-signed APK. MyHealth's sign-in page shows **Get the MyHealth app** with a QR code, the staff landing page **MyHealth, on the phone**.
- Push to the app: `EXPO_PUSH_ENABLED` (and `EXPO_ACCESS_TOKEN` where the Expo project uses enhanced push security) on the API and notification
  worker; see [mobile-app.md](../architecture/mobile-app.md) §8.
- API compatibility (D13): installed app versions keep calling `/api/v1/portal/*`; changes to the routes the app uses must keep working for them.
