import { COLUMNS, previewBytes, previewTicket, renderTicket, toPrintable, wrap } from "./escpos";

const job = {
  ticket: "A-007",
  serviceName: "Consultation",
  facilityName: "Barangay Health Center",
  issuedAt: new Date("2026-11-04T01:30:00Z"),
  instructions: "Please take a seat. Your number will be shown on the screen when it is your turn.",
};

const count = (buffer: Buffer, byte: number) => [...buffer].filter((b) => b === byte).length;

describe("toPrintable", () => {
  it("keeps plain text, drops accents and turns typographic marks into plain ones", () => {
    expect(toPrintable("Señor’s “clinic” – Peña")).toBe('Senor\'s "clinic" - Pena');
  });

  it("removes every control character and replaces what a printer cannot show", () => {
    expect(toPrintable("A\u001b@B\u001d!3C\u0000D\u0007E\u007fF")).toBe("A @B !3C D E F");
    expect(toPrintable("ticket \u{1F600} ok")).toBe("ticket ? ok");
    expect(toPrintable("  many   spaces\n and\tlines ")).toBe("many spaces and lines");
  });
});

describe("wrap", () => {
  it("breaks at spaces within the line width and cuts a word longer than a line", () => {
    expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
    expect(wrap("supercalifragilistic", 8)).toEqual(["supercal", "ifragili", "stic"]);
    expect(wrap("", 10)).toEqual([]);
  });
});

describe("renderTicket", () => {
  it("prints the facility, the number, the service, the time and the instruction, on both paper widths", () => {
    for (const width of [80, 58] as const) {
      const text = previewBytes(renderTicket(job, { width }));
      expect(text).toContain("Barangay Health Center");
      expect(text).toContain("A-007");
      expect(text).toContain("Consultation");
      expect(text).toContain("Nov 04, 2026");
      expect(text).toContain("9:30");
      expect(text).toContain("your turn");
      for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(COLUMNS[width]);
    }
  });

  it("shows the time in the facility's own time zone", () => {
    expect(previewTicket(job, { width: 80, timeZone: "Asia/Manila" })).toContain("9:30");
    expect(previewTicket(job, { width: 80, timeZone: "UTC" })).toContain("1:30");
  });

  it("is the same bytes for the same ticket, and ends with a cut", () => {
    const a = renderTicket(job, { width: 80 });
    expect(renderTicket(job, { width: 80 }).equals(a)).toBe(true);
    // GS V 66 3: feed and partial cut.
    expect([...a.subarray(a.length - 4)]).toEqual([0x1d, 0x56, 0x42, 0x03]);
  });

  it("lets nothing in a text field become a printer command", () => {
    const baseline = renderTicket(job, { width: 80 });
    const hostile = renderTicket(
      {
        ...job,
        ticket: "A-007",
        serviceName: "X\u001b@\u001bp\u0000\u0019\u001d!ÿ\u001dV\u0000",
        facilityName: "\u001b!\u0010 Clinic \u0010\u0004\u0004",
        instructions: "\u001bdÿ\u001bi take a seat \u0007\u0018",
      },
      { width: 80 },
    );
    // The command bytes in the output are exactly those the template writes, however the fields are filled.
    for (const control of [0x1b, 0x1d, 0x10, 0x04, 0x18, 0x19, 0x07, 0xff]) expect(count(hostile, control)).toBe(count(baseline, control));
  });

  it("fits a long ticket number in a quarter of the line, and long names in the line width", () => {
    const long = previewBytes(renderTicket({ ...job, ticket: "A-123456", serviceName: "A".repeat(200), facilityName: "B".repeat(300) }, { width: 58 }));
    for (const line of long.split("\n")) expect(line.length).toBeLessThanOrEqual(COLUMNS[58]);
  });
});
