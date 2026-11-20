import { describe, expect, it } from "vitest";
import { commandItems, commandScreens, parseCommand, rankScreens, type CommandPatient } from "./command-bar";

// Friday 20 November 2026.
const TODAY = "2026-11-20";

const RECEPTION = [
  "patient.search",
  "patient.read",
  "patient.register",
  "appointment.read",
  "appointment.manage",
  "clinic.queue.read",
  "clinic.queue.manage",
  "billing.charge.read",
];
const LAB = ["lab.order.read", "lab.result.read", "lab.result.verify", "lab.specimen.collect", "patient.search", "patient.read"];

const screensFor = (permissions: string[]) => commandScreens(permissions);
const parse = (text: string, permissions = RECEPTION) => parseCommand(text, TODAY, screensFor(permissions));

const reyes: CommandPatient = { id: "p1", patientNumber: "P00000001", displayName: "REYES, Ana", sex: "female", age: 41, status: "active" };

describe("reading days", () => {
  it("reads relative days in English and Filipino", () => {
    expect(parse("tomorrow").date).toBe("2026-11-21");
    expect(parse("bukas").date).toBe("2026-11-21");
    expect(parse("kahapon").date).toBe("2026-11-19");
    expect(parse("ngayon").date).toBe("2026-11-20");
  });

  it("reads weekdays as the next one, today included", () => {
    expect(parse("monday").date).toBe("2026-11-23");
    expect(parse("friday").date).toBe("2026-11-20");
    expect(parse("thu").date).toBe("2026-11-26");
  });

  it("reads month and day, with or without a year, and ISO dates; refuses impossible days", () => {
    expect(parse("nov 25").date).toBe("2026-11-25");
    expect(parse("25 November 2027").date).toBe("2027-11-25");
    expect(parse("appointments 2026-12-01").date).toBe("2026-12-01");
    expect(parse("feb 30").date).toBeNull();
  });
});

describe("reading actions and names", () => {
  it("finds the action at the start, the day, and the name as typed", () => {
    expect(parse("book Reyes tomorrow")).toMatchObject({ verb: "book", date: "2026-11-21", patientQuery: "Reyes" });
    expect(parse("check in Dela Cruz")).toMatchObject({ verb: "checkin", patientQuery: "Dela Cruz" });
  });

  it("finds the action at the end too", () => {
    expect(parse("Reyes check in")).toMatchObject({ verb: "checkin", patientQuery: "Reyes" });
    expect(parse("Santos labs")).toMatchObject({ verb: "labs", patientQuery: "Santos" });
  });

  it("drops filler words and keeps a plain name for the patient search", () => {
    expect(parse("book for Reyes po")).toMatchObject({ verb: "book", patientQuery: "Reyes" });
    expect(parse("Santos")).toMatchObject({ verb: null, patientQuery: "Santos" });
  });

  it("does not search patients for a phrase about screens", () => {
    expect(parse("appointments tomorrow")).toMatchObject({ verb: null, patientQuery: "", words: ["appointments"] });
    expect(parse("queue").patientQuery).toBe("");
    expect(parse("lab results today", LAB)).toMatchObject({ verb: "labs", patientQuery: "", words: ["lab", "results"] });
    expect(parse("new patient")).toMatchObject({ verb: "open", patientQuery: "" });
  });
});

describe("screens", () => {
  it("lists only what the permissions open: navigation, tabs, settings and shortcuts", () => {
    const hrefs = screensFor(RECEPTION).map((s) => s.href);
    expect(hrefs).toEqual(expect.arrayContaining(["/queue", "/appointments", "/billing", "/patients", "/patients/new", "/queue/walk-in", "/appointments/new"]));
    expect(hrefs).not.toContain("/laboratory");
    expect(hrefs).not.toContain("/laboratory/worklist?stage=verify");
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("ranks the screen that holds the most words first", () => {
    expect(rankScreens(["lab", "verify"], screensFor(LAB))[0]).toMatchObject({ label: "Lab worklist · Verify", href: "/laboratory/worklist?stage=verify" });
    expect(rankScreens(["cashier"], screensFor(RECEPTION))[0]!.href).toBe("/billing");
    expect(rankScreens([], screensFor(RECEPTION))).toEqual([]);
  });
});

describe("items", () => {
  const items = (text: string, patients: CommandPatient[] = [], permissions = RECEPTION) =>
    commandItems(parse(text, permissions), { screens: screensFor(permissions), patients, help: [], permissions });

  it("puts the named action on each patient found, with the day, before the screens", () => {
    const list = items("book Reyes tomorrow", [reyes]);
    expect(list[0]).toEqual({
      id: "patient:p1",
      group: "Patients",
      label: "Book an appointment: REYES, Ana",
      detail: "P00000001 · 41 F",
      href: "/appointments/new?patientId=p1&date=2026-11-21",
    });
    expect(list.at(-1)).toMatchObject({ group: "Search", label: "Search patients for “Reyes”", href: "/patients?q=Reyes" });
  });

  it("falls back to opening the record when the action is not the person's", () => {
    const list = items("book Reyes", [reyes], ["patient.search", "patient.read"]);
    expect(list[0]).toMatchObject({ label: "Open the record: REYES, Ana", href: "/patients/p1" });
  });

  it("opens a day on screens that show one, and a day alone lists them", () => {
    expect(items("appointments friday")[0]).toMatchObject({ label: "Appointments", detail: "for 2026-11-20", href: "/appointments?date=2026-11-20" });
    expect(items("tomorrow").map((i) => i.href)).toEqual(["/appointments?date=2026-11-21", "/appointments/new?date=2026-11-21"]);
  });

  it("names patients first when the phrase has an action, then screens, help and the full search", () => {
    const list = commandItems(parse("billing Santos"), {
      screens: screensFor(RECEPTION),
      patients: [{ ...reyes, id: "p2", displayName: "SANTOS, Jose", sex: "male", status: "inactive" }],
      help: [
        {
          chapter: "10-billing",
          chapterTitle: "Billing",
          heading: "How to record a payment",
          href: "/help/10-billing#how-to-record-a-payment",
          text: "",
          score: 3,
        } as never,
      ],
      permissions: RECEPTION,
    });
    // "billing" is an action word here ("open billing" for Santos).
    expect(list[0]).toMatchObject({
      group: "Patients",
      label: "Open billing: SANTOS, Jose",
      detail: "P00000001 · 41 M · inactive",
      href: "/billing/patients/p2",
    });
    // A receptionist reaches the cashier's desk and the invoice list, not the daily report.
    expect(list.map((i) => [i.group, i.label])).toEqual([
      ["Patients", "Open billing: SANTOS, Jose"],
      ["Screens", "Billing"],
      ["Screens", "Billing · Invoices"],
      ["Help", "How to record a payment"],
      ["Search", "Search patients for “Santos”"],
    ]);
  });

  it("lists screens before patients when no action is named", () => {
    const list = items("queue Santos", [{ ...reyes, id: "p2", displayName: "SANTOS, Jose" }]);
    expect(list.map((i) => [i.group, i.label])).toEqual([
      ["Screens", "Queue"],
      ["Patients", "Open the record: SANTOS, Jose"],
      ["Search", "Search patients for “Santos”"],
    ]);
  });

  it("offers nothing a person may not open", () => {
    expect(items("lab verify", [], RECEPTION).filter((i) => i.href.startsWith("/laboratory"))).toEqual([]);
  });
});
