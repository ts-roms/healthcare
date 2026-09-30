export type CsvCell = string | number | null;

/**
 * RFC 4180 CSV (CRLF, quoted when needed). A cell starting with = + - @ (or a tab / carriage return) is prefixed with
 * an apostrophe so spreadsheets never run it as a formula — names come from staff-entered data.
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  const cell = (value: CsvCell) => {
    if (value === null) return "";
    if (typeof value === "number") return String(value);
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
