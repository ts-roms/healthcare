import { describe, expect, it } from "vitest";
import { bytesToBase64Url, pushMessage, pushSupport, urlBase64ToUint8Array } from "./push";

describe("push in the browser", () => {
  it("turns the clinic's key into bytes and a browser key back into base64url", () => {
    const bytes = urlBase64ToUint8Array("AQID_w"); // 01 02 03 ff
    expect([...bytes]).toEqual([1, 2, 3, 255]);
    expect(bytesToBase64Url(bytes.buffer)).toBe("AQID_w");
  });

  it("needs a secure address, a service worker and push; a blocked permission is its own state", () => {
    const ok = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, permission: "default", secure: true };
    expect(pushSupport(ok)).toBe("ready");
    expect(pushSupport({ ...ok, permission: "granted" })).toBe("ready");
    expect(pushSupport({ ...ok, permission: "denied" })).toBe("denied");
    expect(pushSupport({ ...ok, secure: false })).toBe("unsupported");
    expect(pushSupport({ ...ok, hasPushManager: false })).toBe("unsupported");
    expect(pushSupport({ ...ok, hasServiceWorker: false })).toBe("unsupported");
  });

  it("puts the API's refusals in words", () => {
    expect(pushMessage("too_many_push_devices", "x")).toContain("up to 5");
    expect(pushMessage("other", "Fallback")).toBe("Fallback");
  });
});
