/** Times shown on the kiosk are the facility's local times (default Asia/Manila), whatever the screen's own clock says. */
export const DEFAULT_TIME_ZONE = "Asia/Manila";

export const formatTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));

export const formatDateTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-PH", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(
    new Date(iso),
  );

/** Today's date in the facility's time zone as `YYYY-MM-DD` (the `en-CA` locale writes that shape). */
export const localToday = (timeZone: string, now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
