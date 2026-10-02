/**
 * Screen protection (docs/architecture/mobile-app.md, D11): when the app is not in the foreground its screens are covered,
 * so the app switcher shows the cover, not a patient's results. Pure rule, tested in Node; the hook and the cover live in
 * `components/privacy-cover.tsx`.
 */
export type ForegroundState = "active" | "inactive" | "background" | "extension" | "unknown";

/** Cover whenever the app is not plainly active (iOS reports `inactive` as the switcher opens, Android `background`). */
export function shouldCover(state: ForegroundState | string | null | undefined): boolean {
  return state !== "active";
}
