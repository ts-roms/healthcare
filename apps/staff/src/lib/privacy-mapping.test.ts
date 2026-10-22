import { describe, expect, it } from "vitest";
import { notificationClock } from "./privacy-mapping";

describe("privacy mapping", () => {
  it("words the notification window as time left or past", () => {
    expect(notificationClock({ notificationPending: false, hoursLeft: null })).toBeNull();
    expect(notificationClock({ notificationPending: true, hoursLeft: 41.4 })).toBe("41 h left");
    expect(notificationClock({ notificationPending: true, hoursLeft: 72 })).toBe("3 days left");
    expect(notificationClock({ notificationPending: true, hoursLeft: -12 })).toBe("12 h past the window");
  });
});
