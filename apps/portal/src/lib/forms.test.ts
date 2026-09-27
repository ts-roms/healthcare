import { describe, expect, it } from "vitest";
import { ApiError } from "@healthcare/web-session";
import { activateFormSchema, loginFormSchema, parseForm, patientMessage } from "./forms";

const ACTIVATE_FIELDS = ["patientNumber", "birthDate", "activationCode", "email", "password", "confirmPassword"] as const;

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

const valid = {
  patientNumber: " p-000123 ",
  birthDate: "1980-05-14",
  activationCode: "abcde-fghjk",
  email: " Maria@Example.com ",
  password: "correct horse battery",
  confirmPassword: "correct horse battery",
};

describe("activateFormSchema", () => {
  it("normalizes the patient number, code and email", () => {
    const result = parseForm(activateFormSchema, form(valid), ACTIVATE_FIELDS);
    expect(result).toMatchObject({ ok: true, data: { patientNumber: "P-000123", activationCode: "ABCDEFGHJK", email: "maria@example.com" } });
  });

  it("accepts a code typed without the dash or with spaces", () => {
    expect(parseForm(activateFormSchema, form({ ...valid, activationCode: "abcde fghjk" }), ACTIVATE_FIELDS).ok).toBe(true);
  });

  it("reports one message per field", () => {
    const result = parseForm(activateFormSchema, form({ ...valid, birthDate: "", activationCode: "ABC", password: "short", confirmPassword: "other" }), ACTIVATE_FIELDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.birthDate).toBe("Enter your date of birth.");
    expect(result.errors.activationCode).toMatch(/10 letters/);
    expect(result.errors.password).toMatch(/at least 12/);
  });

  it("rejects repetitive passwords and mismatched confirmation", () => {
    const repetitive = parseForm(activateFormSchema, form({ ...valid, password: "aaaaaaaaaaaaaa", confirmPassword: "aaaaaaaaaaaaaa" }), ACTIVATE_FIELDS);
    expect(repetitive.ok || repetitive.errors.password).toMatch(/repetitive/);
    const mismatch = parseForm(activateFormSchema, form({ ...valid, confirmPassword: "correct horse battery!" }), ACTIVATE_FIELDS);
    expect(mismatch.ok || mismatch.errors.confirmPassword).toMatch(/do not match/);
  });
});

describe("loginFormSchema", () => {
  it("requires a valid email and a password", () => {
    const result = parseForm(loginFormSchema, form({ email: "nope", password: "" }), ["email", "password"]);
    expect(result).toEqual({ ok: false, errors: { email: "Enter a valid email address.", password: "Enter your password." } });
  });
});

describe("patientMessage", () => {
  it("passes through the API's patient-facing message with a support reference", () => {
    const error = new ApiError(401, "invalid_credentials", "Invalid email or password", undefined, "0123456789abcdef");
    expect(patientMessage(error)).toBe("Invalid email or password (ref 01234567)");
  });

  it("uses plain language for rate limits, validation, server and network failures", () => {
    expect(patientMessage(new ApiError(429, "rate_limited", "ThrottlerException: Too Many Requests"))).toMatch(/Too many attempts/);
    expect(patientMessage(new ApiError(400, "validation_failed", "Request validation failed"))).toMatch(/not accepted/);
    expect(patientMessage(new ApiError(500, "internal_error", "boom"))).toMatch(/our side/);
    expect(patientMessage(new TypeError("fetch failed"))).toMatch(/couldn't reach/);
  });
});
