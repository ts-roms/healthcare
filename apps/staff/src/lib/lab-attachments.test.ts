import { describe, expect, it } from "vitest";
import { attachmentTitle, checkAttachmentFile, fileSize, MAX_ATTACHMENT_BYTES } from "./lab-attachments";

describe("result attachment files", () => {
  it("accepts PDFs and images within the size limit", () => {
    expect(checkAttachmentFile({ name: "plate.jpg", type: "image/jpeg", size: 2048 })).toBeNull();
    expect(checkAttachmentFile({ name: "report.pdf", type: "application/pdf", size: MAX_ATTACHMENT_BYTES })).toBeNull();
  });

  it("refuses empty, too large, unsupported or oddly named files", () => {
    expect(checkAttachmentFile({ name: "a.pdf", type: "application/pdf", size: 0 })).toMatch(/empty/);
    expect(checkAttachmentFile({ name: "a.pdf", type: "application/pdf", size: MAX_ATTACHMENT_BYTES + 1 })).toMatch(/10 MB/);
    expect(checkAttachmentFile({ name: "a.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10 })).toMatch(
      /PDF or an image/,
    );
    expect(checkAttachmentFile({ name: "a/b.pdf", type: "application/pdf", size: 10 })).toMatch(/Rename/);
  });

  it("derives a title and formats sizes", () => {
    expect(attachmentTitle("Culture plate.jpg")).toBe("Culture plate");
    expect(attachmentTitle(".pdf")).toBe(".pdf");
    expect(fileSize(900)).toBe("900 B");
    expect(fileSize(1536)).toBe("1.5 KB");
    expect(fileSize(2 * 1024 * 1024)).toBe("2 MB");
  });
});
