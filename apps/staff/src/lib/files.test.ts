import { describe, expect, it } from "vitest";
import { fileApiPath, fileHref } from "./files";

const id = "9e121d11-9636-4505-836b-66d13ba58f5e";

describe("file routes", () => {
  it("maps known documents to their API path", () => {
    expect(fileApiPath(["lab-reports", id])).toBe(`/laboratory/orders/${id}/report.pdf`);
    expect(fileApiPath(["invoices", id])).toBe(`/billing/invoices/${id}/pdf`);
    expect(fileApiPath(["receipts", id])).toBe(`/billing/payments/${id}/receipt.pdf`);
    expect(fileApiPath(["specimen-labels", id])).toBe(`/laboratory/specimens/${id}/label.pdf`);
    expect(fileApiPath(["lab-report-archive", id])).toBe(`/laboratory/report-archive/${id}/report.pdf`);
    expect(fileHref.invoice(id)).toBe(`/files/invoices/${id}`);
    expect(fileHref.specimenLabel(id)).toBe(`/files/specimen-labels/${id}`);
    expect(fileHref.archivedLabReport(id)).toBe(`/files/lab-report-archive/${id}`);
    expect(fileApiPath(["deposit-receipts", id])).toBe(`/billing/account-entries/${id}/receipt.pdf`);
    expect(fileApiPath(["credit-notes", id])).toBe(`/billing/credit-notes/${id}/pdf`);
    expect(fileHref.creditNote(id)).toBe(`/files/credit-notes/${id}`);
    expect(fileApiPath(["debit-notes", id])).toBe(`/billing/debit-notes/${id}/pdf`);
    expect(fileApiPath(["send-out-manifests", id])).toBe(`/laboratory/send-out-dispatches/${id}/manifest.pdf`);
    expect(fileHref.sendOutManifest(id)).toBe(`/files/send-out-manifests/${id}`);
    expect(fileApiPath(["dental-estimates", id])).toBe(`/dental/treatment-plans/${id}/estimate.pdf`);
    expect(fileHref.dentalEstimate(id)).toBe(`/files/dental-estimates/${id}`);
    expect(fileApiPath(["medical-certificates", id])).toBe(`/medical-certificates/${id}/certificate.pdf`);
    expect(fileHref.medicalCertificate(id)).toBe(`/files/medical-certificates/${id}`);
    expect(fileApiPath(["referral-letters", id])).toBe(`/referrals/${id}/letter.pdf`);
    expect(fileHref.referralLetter(id)).toBe(`/files/referral-letters/${id}`);
  });

  it("passes nothing else through", () => {
    expect(fileApiPath(["invoices", "../patients"])).toBeNull();
    expect(fileApiPath(["patients", id])).toBeNull();
    expect(fileApiPath(["invoices", id, "extra"])).toBeNull();
  });
});
