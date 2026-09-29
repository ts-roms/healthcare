import { afterEach, describe, expect, it } from "vitest";
import { clinicalDateTime, clinicalTime, currentClinicTimeZone, setClinicTimeZone, setClinicTimeZoneResolver } from "./format";

const AT = "2026-09-30T01:42:00Z";

describe("clinical time zone", () => {
  afterEach(() => {
    setClinicTimeZoneResolver(undefined);
    setClinicTimeZone(undefined);
  });

  it("shows Manila time by default", () => {
    expect(currentClinicTimeZone()).toBe("Asia/Manila");
    expect(clinicalDateTime(AT)).toBe("30 Sep 2026, 09:42");
  });

  it("shows the facility's zone once set, and ignores unknown zones", () => {
    setClinicTimeZone("Asia/Tokyo");
    expect(clinicalTime(AT)).toBe("10:42");
    setClinicTimeZone("Not/AZone");
    expect(clinicalTime(AT)).toBe("09:42");
  });

  it("prefers a request-scoped zone over the page-wide one", () => {
    setClinicTimeZone("Asia/Tokyo");
    let requestZone: string | undefined = "UTC";
    setClinicTimeZoneResolver(() => requestZone);
    expect(clinicalTime(AT)).toBe("01:42");
    requestZone = undefined;
    expect(clinicalTime(AT)).toBe("10:42");
  });
});
