import type { DomainEventRecord } from "@healthcare/core";
import { findTemplate } from "@healthcare/notification";
import { AppointmentCancellationNotices } from "./appointment-cancellation-notices";

type Sent = { userId: string; variables: Record<string, string>; templateKey: string };

function setup({ practitionerUserId = "doc-user", managers = ["desk-1", "desk-2"] } = {}) {
  const sent: Sent[] = [];
  const notices = new AppointmentCancellationNotices(
    { on: () => undefined } as never,
    {
      send: async (_actor: unknown, input: { recipient: { userId: string }; variables: Record<string, string>; templateKey: string }) => {
        sent.push({ userId: input.recipient.userId, variables: input.variables, templateKey: input.templateKey });
        return { status: "queued" };
      },
    } as never,
    { getFacility: async () => ({ name: "Main Clinic", timezone: "Asia/Manila" }) } as never,
    {
      practitionerUserId: async () => practitionerUserId,
      practitionerNames: async () => new Map([["prac-1", "Dr. Ana Santos"]]),
    } as never,
    {
      holdersOf: async () => managers.map((id) => ({ id, displayName: id })),
      displayNames: async () => new Map([["desk-1", "Liza Mendoza"]]),
    } as never,
  );
  return { notices, sent };
}

const event = (payload: Record<string, unknown>): DomainEventRecord =>
  ({
    id: "evt-1",
    organizationId: "org",
    facilityId: "fac",
    patientId: "pat",
    eventType: "AppointmentCancelled",
    payload: { practitionerId: "prac-1", startsAt: "2026-12-05T01:00:00.000Z", status: "cancelled", ...payload },
  }) as unknown as DomainEventRecord;

describe("AppointmentCancellationNotices", () => {
  it("tells the practitioner and the front desk when the patient cancels in MyHealth", async () => {
    const { notices, sent } = setup();
    await notices.handle(event({ changedByPatient: true }));
    expect(sent.map((s) => s.userId).sort()).toEqual(["desk-1", "desk-2", "doc-user"]);
    expect(sent[0]!.templateKey).toBe("appointment.cancelled-notice");
    expect(sent[0]!.variables).toEqual({
      day: "2026-12-05",
      date: "5 Dec 2026",
      time: "09:00",
      practitionerName: "Dr. Ana Santos",
      cancelledBy: "the patient in MyHealth",
    });
  });

  it("names the staff member who cancelled and does not tell them", async () => {
    const { notices, sent } = setup();
    await notices.handle(event({ cancelledBy: "desk-1" }));
    expect(sent.map((s) => s.userId).sort()).toEqual(["desk-2", "doc-user"]);
    expect(sent[0]!.variables["cancelledBy"]).toBe("Liza Mendoza");
  });

  it("renders a notice that links to the day and never names the patient", async () => {
    const { notices, sent } = setup();
    await notices.handle(event({ changedByPatient: true }));
    const rendered = findTemplate("appointment.cancelled-notice")!.render(sent[0]!.variables as never);
    expect(rendered.subject).toBe("Appointment cancelled");
    expect(rendered.text).toBe(
      "An appointment on 5 Dec 2026 at 09:00 with Dr. Ana Santos was cancelled by the patient in MyHealth. The time can be booked again.",
    );
    expect(rendered.href).toBe("/appointments?date=2026-12-05");
  });
});
