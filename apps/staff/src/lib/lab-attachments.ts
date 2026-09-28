/** File types a result attachment may have (the API accepts these and DICOM; DICOM is not offered from the browser). */
export const ATTACHMENT_FILE_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/heic": "HEIC",
  "image/tiff": "TIFF",
};

/** Server actions carry at most 12 MB; attachments stay below with room for the form. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Why a file cannot be attached, or null. The API checks again. */
export function checkAttachmentFile(file: { name: string; type: string; size: number }): string | null {
  if (file.size === 0) return "The file is empty.";
  if (!ATTACHMENT_FILE_TYPES[file.type]) return "Attach a PDF or an image (JPEG, PNG, HEIC or TIFF).";
  if (file.size > MAX_ATTACHMENT_BYTES) return "The file is larger than 10 MB. Scan at a lower resolution or attach a PDF.";
  if (/[\\/\0]/.test(file.name) || file.name.length > 200) return "Rename the file (no slashes, at most 200 characters).";
  return null;
}

/** "Culture plate.jpg" → "Culture plate": a default title from the file name. */
export function attachmentTitle(fileName: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
  return (base || fileName).slice(0, 200);
}

/** 1536 → "1.5 KB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}
