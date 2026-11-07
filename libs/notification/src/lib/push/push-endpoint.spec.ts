import { isPublicPushEndpoint } from "./push-endpoint";

describe("isPublicPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QAbc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts %s", (endpoint) => expect(isPublicPushEndpoint(endpoint)).toBe(true));

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://localhost/push",
    "https://127.0.0.1/push",
    "https://[::1]/push",
    "https://10.0.0.5/push",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata/push",
    "https://db.railway.internal/push",
    "https://printer.local/push",
    "https://user:pass@fcm.googleapis.com/fcm",
    "https://fcm.googleapis.com:8443/fcm",
    "not a url",
    // A public host that is not a push service (it could resolve anywhere).
    "https://attacker-rebind.example/push",
    "https://fcm.googleapis.com.attacker.example/fcm",
    "https://push.apple.com/x",
  ])("refuses %s", (endpoint) => expect(isPublicPushEndpoint(endpoint)).toBe(false));
});
