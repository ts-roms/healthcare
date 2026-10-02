import { createHash } from "node:crypto";
import { BusinessRuleError } from "@healthcare/core";
import {
  assertPasswordAccepted,
  NO_BREACHED_PASSWORD_CHECK,
  PasswordCheckUnavailable,
  PwnedPasswordsRangeChecker,
  passwordRefusal,
  screenPassword,
} from "./breached-passwords";

const PASSWORD = "Correct-Horse-Battery-9";
const DIGEST = createHash("sha1").update(PASSWORD).digest("hex").toUpperCase();
const PREFIX = DIGEST.slice(0, 5);
const SUFFIX = DIGEST.slice(5);
const OTHER = "0".repeat(35);

function fakeFetch(answer: () => Promise<Response>): { fetchFn: typeof fetch; urls: string[]; headers: Array<Record<string, string>> } {
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    headers.push((init?.headers ?? {}) as Record<string, string>);
    return answer();
  }) as typeof fetch;
  return { fetchFn, urls, headers };
}

const text =
  (body: string, status = 200) =>
  async () =>
    new Response(body, { status });

describe("PwnedPasswordsRangeChecker", () => {
  it("sends only the five-character prefix, with padding, and finds a breached suffix", async () => {
    const fake = fakeFetch(text(`${OTHER}:3\r\n${SUFFIX}:42\r\n`));
    await expect(new PwnedPasswordsRangeChecker(fake.fetchFn).isBreached(PASSWORD)).resolves.toBe(true);
    expect(fake.urls).toEqual([`https://api.pwnedpasswords.com/range/${PREFIX}`]);
    expect(fake.urls[0]).not.toContain(SUFFIX);
    expect(fake.headers[0]).toMatchObject({ "Add-Padding": "true" });
  });

  it("matches the suffix whatever its case", async () => {
    const fake = fakeFetch(text(`${SUFFIX.toLowerCase()}:1\n`));
    await expect(new PwnedPasswordsRangeChecker(fake.fetchFn).isBreached(PASSWORD)).resolves.toBe(true);
  });

  it("reports not found when the suffix is absent", async () => {
    const fake = fakeFetch(text(`${OTHER}:7\n`));
    await expect(new PwnedPasswordsRangeChecker(fake.fetchFn).isBreached(PASSWORD)).resolves.toBe(false);
  });

  it("ignores padding entries (count 0)", async () => {
    const fake = fakeFetch(text(`${SUFFIX}:0\n${OTHER}:2\n`));
    await expect(new PwnedPasswordsRangeChecker(fake.fetchFn).isBreached(PASSWORD)).resolves.toBe(false);
  });

  it.each([
    ["an HTTP error", text("Service unavailable", 503)],
    ["an unreadable answer", text("<html>blocked</html>")],
    ["an empty answer", text("")],
    [
      "a network failure",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("is unavailable on %s", async (_label, answer) => {
    const fake = fakeFetch(answer);
    await expect(new PwnedPasswordsRangeChecker(fake.fetchFn).isBreached(PASSWORD)).rejects.toBeInstanceOf(PasswordCheckUnavailable);
  });

  it("is unavailable when the answer is too slow", async () => {
    const fetchFn = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch;
    await expect(new PwnedPasswordsRangeChecker(fetchFn, 20).isBreached(PASSWORD)).rejects.toBeInstanceOf(PasswordCheckUnavailable);
  });
});

describe("screenPassword", () => {
  it("accepts, refuses a breached password, and refuses one that cannot be checked", async () => {
    await expect(screenPassword({ isBreached: async () => false }, PASSWORD)).resolves.toBe("accepted");
    await expect(screenPassword({ isBreached: async () => true }, PASSWORD)).resolves.toBe("password_breached");
    const unavailable = {
      isBreached: async (): Promise<boolean> => {
        throw new PasswordCheckUnavailable("down");
      },
    };
    await expect(screenPassword(unavailable, PASSWORD)).resolves.toBe("password_check_unavailable");
  });

  it("accepts everything when screening is turned off", async () => {
    await expect(screenPassword(NO_BREACHED_PASSWORD_CHECK, PASSWORD)).resolves.toBe("accepted");
  });
});

describe("refusals", () => {
  it("answer 422 business-rule errors with their own codes", async () => {
    expect(passwordRefusal("password_breached")).toBeInstanceOf(BusinessRuleError);
    expect(passwordRefusal("password_breached").code).toBe("password_breached");
    expect(passwordRefusal("password_check_unavailable").code).toBe("password_check_unavailable");
    await expect(assertPasswordAccepted({ isBreached: async () => true }, PASSWORD)).rejects.toMatchObject({ code: "password_breached" });
    await expect(assertPasswordAccepted({ isBreached: async () => false }, PASSWORD)).resolves.toBeUndefined();
  });
});
