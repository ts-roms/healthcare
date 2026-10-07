import { createHash } from "node:crypto";
import { blocksServing, checkIntegrity, countOutcome, EMPTY_COUNTS } from "./document-integrity.rules";

const bytes = Buffer.from("a stored document");
const hash = createHash("sha256").update(bytes).digest("hex");

describe("document integrity rules", () => {
  it("verifies bytes whose hash matches the recorded one, and reports a mismatch with both hashes", () => {
    expect(checkIntegrity(hash, { kind: "bytes", bytes })).toEqual({ outcome: "verified", computedSha256: hash });
    const changed = checkIntegrity(hash, { kind: "bytes", bytes: Buffer.from("a stored document, altered") });
    expect(changed.outcome).toBe("mismatch");
    expect(changed.computedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(changed.computedSha256).not.toBe(hash);
  });

  it("baselines a document without a recorded hash instead of verifying it", () => {
    expect(checkIntegrity(null, { kind: "bytes", bytes })).toEqual({ outcome: "baselined", computedSha256: hash });
  });

  it("reports a missing object and storage that did not answer, concluding nothing about the bytes", () => {
    expect(checkIntegrity(hash, { kind: "missing" })).toEqual({ outcome: "missing", computedSha256: null });
    expect(checkIntegrity(hash, { kind: "unreadable" })).toEqual({ outcome: "unreadable", computedSha256: null });
    expect(checkIntegrity(null, { kind: "missing" }).outcome).toBe("missing");
  });

  it("refuses serving only on a mismatch or a missing object", () => {
    expect(blocksServing("mismatch")).toBe(true);
    expect(blocksServing("missing")).toBe(true);
    expect(blocksServing("unreadable")).toBe(false);
    expect(blocksServing("verified")).toBe(false);
    expect(blocksServing(null)).toBe(false);
  });

  it("counts outcomes so that checked is always the sum", () => {
    let counts = EMPTY_COUNTS;
    for (const outcome of ["verified", "verified", "baselined", "mismatch", "missing", "unreadable"] as const) counts = countOutcome(counts, outcome);
    expect(counts).toEqual({ checked: 6, verified: 2, baselined: 1, mismatched: 1, missing: 1, unreadable: 1 });
  });
});
