import { expect, test } from "@playwright/test";
import { authenticator } from "otplib";
import { Client } from "pg";
import { loadState } from "../support/api";
import { E2E_DATABASE_URL, PATIENT_PASSWORD } from "../support/env";
import { portalPage } from "../support/pages";

/**
 * Passkeys in MyHealth (docs/architecture/portal-app.md, "Passkeys"): the patient verifies their email, turns on
 * two-step verification with an authenticator app, adds a passkey (Chromium's virtual authenticator stands in for the
 * phone's lock), and signs in again answering the second step with it instead of a code. Runs last: the patient keeps
 * two-step verification on.
 */
test("a patient adds a passkey and signs in with it instead of a code", async ({ browser }) => {
  const state = loadState();
  const patient = state.onlinePatient;
  const errors: string[] = [];
  const page = await portalPage(browser, patient.email, errors);

  // A virtual platform authenticator with user verification, as a phone's fingerprint or PIN would give.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto("/security");
  await expect(page.getByRole("heading", { name: "Sign-in security" })).toBeVisible();

  // The email code, read from the message waiting to be sent (no mail server in this run).
  await page.getByRole("button", { name: "Send me a code" }).click();
  const codeInput = page.getByLabel(/Code sent to/);
  await expect(codeInput).toBeVisible();
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  const { rows } = await db.query<{ code: string }>(
    `SELECT variables->>'code' AS code FROM notification WHERE recipient_patient_id = $1 AND template_key = 'portal.email-verification' ORDER BY created_at DESC LIMIT 1`,
    [patient.id],
  );
  await db.end();
  await codeInput.fill(rows[0]!.code);
  await page.getByRole("button", { name: "Confirm" }).click();

  // Two-step verification with an authenticator app, from the setup key shown on the page.
  await page.getByRole("button", { name: "Turn on" }).click();
  await page.getByLabel("Your password").fill(PATIENT_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  const setupKey = (await page.locator("p.select-all").innerText()).replace(/\s+/g, "");
  await page.getByLabel("Code from the app").fill(authenticator.generate(setupKey));
  await page.getByRole("button", { name: "Turn on" }).click();
  const recoveryCodes = await page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem").allInnerTexts();
  expect(recoveryCodes).toHaveLength(10);
  await page.getByRole("button", { name: "I saved them" }).click();

  // The passkey: the password and a recovery code (the app's code was just used), then the device's own lock.
  const passkeys = page.getByRole("region", { name: "Passkeys" });
  await expect(passkeys).toContainText("You have no passkey.");
  await passkeys.getByRole("button", { name: "Add a passkey" }).click();
  await passkeys.getByLabel("Your password").fill(PATIENT_PASSWORD);
  await passkeys.getByLabel(/a recovery code/).fill(recoveryCodes[0]!);
  await passkeys.getByLabel("Name (optional)").fill("E2E phone");
  await passkeys.getByRole("button", { name: "Continue" }).click();
  await expect(passkeys.getByText("Passkey added.")).toBeVisible();
  await expect(passkeys.getByRole("list", { name: "Passkeys" })).toContainText("E2E phone");

  // Signed out (cookies cleared), then the password and the passkey.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(patient.email);
  await page.getByLabel("Password").fill(PATIENT_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Now use your passkey/)).toBeVisible();
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login")), page.getByRole("button", { name: "Use a passkey" }).click()]);

  await page.goto("/security");
  await expect(page.getByRole("region", { name: "Passkeys" })).toContainText(/last used/);
  expect(errors).toEqual([]);
});
