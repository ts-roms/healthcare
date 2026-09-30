import { describeDevice } from "./push-subscription.service";
import { pushPayload } from "./web-push.sender";

describe("push devices", () => {
  it("describes a device from the browser's own identification, and no more", () => {
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1")).toBe(
      "Safari on iPhone or iPad",
    );
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0")).toBe("Firefox on Windows");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0")).toBe("Edge on Windows");
    expect(describeDevice(null)).toBe("Browser");
  });

  it("puts only a title, one line and a page in the message", () => {
    expect(JSON.parse(pushPayload({ subject: "You have a new message", text: "Clinic: you have a new message in MyHealth. Sign in to read it." }))).toEqual({
      title: "You have a new message",
      body: "Clinic: you have a new message in MyHealth. Sign in to read it.",
      url: "/messages",
    });
    expect(JSON.parse(pushPayload({ text: "x", href: "/notification-settings" }))).toMatchObject({ title: "MyHealth", url: "/notification-settings" });
  });
});
