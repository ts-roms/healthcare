import { questionnaireSchema } from "./questionnaire";
import { canMove, roomName, videoOpen } from "./telemedicine.rules";

describe("telemedicine session", () => {
  it("moves forward only", () => {
    expect(canMove("scheduled", "waiting")).toBe(true);
    expect(canMove("waiting", "in_consultation")).toBe(true);
    expect(canMove("in_consultation", "escalated")).toBe(true);
    expect(canMove("scheduled", "in_consultation")).toBe(false);
    expect(canMove("ended", "in_consultation")).toBe(false);
  });

  it("opens video only during the consultation", () => {
    expect(videoOpen("waiting")).toBe(false);
    expect(videoOpen("in_consultation")).toBe(true);
    expect(videoOpen("ended")).toBe(false);
  });

  it("uses opaque room names", () => {
    expect(roomName("0123456789abcdef0123456789abcdef")).toBe("tm-0123456789abcdef0123456789abcdef");
    expect(() => roomName("juan-dela-cruz")).toThrow();
  });
});

describe("questionnaire", () => {
  const valid = { reasonForVisit: "Cough for a week", locationCity: "Makati City", callbackNumber: "0917 123 4567", acknowledgesOnlineConsultation: true };

  it("needs the essentials and the acknowledgement", () => {
    expect(questionnaireSchema.safeParse(valid).success).toBe(true);
    expect(questionnaireSchema.safeParse({ ...valid, acknowledgesOnlineConsultation: false }).success).toBe(false);
    expect(questionnaireSchema.safeParse({ ...valid, callbackNumber: "call me" }).success).toBe(false);
  });

  it("accepts only known red flags", () => {
    expect(questionnaireSchema.parse({ ...valid, redFlags: ["chest_pain"] }).redFlags).toEqual(["chest_pain"]);
    expect(questionnaireSchema.safeParse({ ...valid, redFlags: ["headache"] }).success).toBe(false);
  });
});
