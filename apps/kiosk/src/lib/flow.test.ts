import { describe, expect, it } from "vitest";
import { type FlowState, flowReducer, INITIAL_FLOW, type IssuedTicket, type KioskAppointment } from "./flow";
import type { RegistrationForm } from "./registration";

const appointment: KioskAppointment = { id: "a1", startsAt: "2026-11-03T02:00:00Z", service: "Consultation", practitioner: "Dr. Reyes", checkIn: "open" };
const ticket: IssuedTicket = {
  ticket: "A-007",
  queueNumber: 7,
  facilityName: "Main",
  issuedAt: "2026-11-03T01:00:00Z",
  instructions: "Sit",
  service: "Consultation",
};
const identified: FlowState = flowReducer(flowReducer(INITIAL_FLOW, { type: "start" }), {
  type: "identified",
  patient: { maskedName: "M.D.C.", birthYear: 1985 },
  appointments: [appointment],
});

describe("kiosk flow", () => {
  it("shows today's appointments first and walk-in services when there are none", () => {
    expect(identified.step).toBe("appointments");
    const none = flowReducer(INITIAL_FLOW, { type: "identified", patient: { maskedName: "M.D.C.", birthYear: 1985 }, appointments: [] });
    expect(none.step).toBe("services");
  });

  it("goes back one step at a time and out of the flow from the first", () => {
    const services = flowReducer(identified, { type: "other-services" });
    expect(services.step).toBe("services");
    expect(flowReducer(services, { type: "back" }).step).toBe("appointments");
    expect(flowReducer({ ...INITIAL_FLOW, step: "type" }, { type: "back" })).toEqual(INITIAL_FLOW);
  });

  it("keeps nothing about the person after the screen is reset", () => {
    const withTicket = flowReducer(identified, { type: "ticket", ticket });
    expect(withTicket.step).toBe("ticket");
    expect(flowReducer(withTicket, { type: "reset" })).toEqual(INITIAL_FLOW);
  });

  it("drops the typed registration as soon as it is sent, keeping only the reference", () => {
    const typed = flowReducer({ ...INITIAL_FLOW, step: "register" }, { type: "review", form: { givenName: "Maria" } as RegistrationForm });
    expect(typed.form).not.toBeNull();
    const sent = flowReducer(typed, { type: "submitted", reference: "KR-ABC234" });
    expect(sent).toEqual({ ...INITIAL_FLOW, step: "submitted", reference: "KR-ABC234" });
  });

  it("clears the identified patient when the session locks", () => {
    expect(flowReducer(identified, { type: "locked" })).toEqual({ ...INITIAL_FLOW, step: "locked" });
  });
});
