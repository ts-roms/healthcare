import {
  AUDIENCE_IDEAS_RULE,
  audienceIdeas,
  audienceIdeaSuggestions,
  bestSendWindow,
  FREQUENCY_LOAD_RULE,
  frequencyLoadSuggestions,
  inQuietHours,
  monthsFromDays,
  SEND_HOUR_RULE,
  segmentDraftHref,
  sendHourSuggestions,
  usualSendHour,
  windowVisits,
} from "./outreach.rules";

/** The one item a case expects; the test fails when there is not exactly one. */
function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  return items[0] as T;
}

/** 24 hourly counts: `base` everywhere, `peaks` added at the given hours. */
function hours(base: number, peaks: Record<number, number> = {}): number[] {
  return Array.from({ length: 24 }, (_, h) => base + (peaks[h] ?? 0));
}

describe("crm.send-hour", () => {
  const params = SEND_HOUR_RULE.defaultParameters;

  it("says nothing on too little MyHealth use", () => {
    expect(sendHourSuggestions({ hourly: hours(1, { 20: 50 }), quietHours: null, recentSendHours: [] }, params)).toEqual([]);
  });

  it("points to the evening when patients use MyHealth most", () => {
    const hourly = hours(5, { 19: 80, 20: 90 });
    const s = only(sendHourSuggestions({ hourly, quietHours: null, recentSendHours: [] }, params));
    expect(s).toMatchObject({ ruleId: "crm.send-hour", severity: "info", strength: "matched", basis: "statistic", surface: "outreach" });
    expect(s.title).toBe("Patients use MyHealth most around 19:00–21:00");
    expect(s.rationale).toContain("of MyHealth visits in the last 28 days fell between 19:00 and 21:00");
    expect(s.evidence.find((e) => e.resourceId === "total")?.value).toBe("290");
    expect(s.action?.href).toBe("/outreach#campaigns");
  });

  it("advises when recent campaigns go out at a quiet time of day, and is silent when they already go out at the best one", () => {
    const hourly = hours(5, { 19: 80, 20: 90 });
    const s = only(sendHourSuggestions({ hourly, quietHours: null, recentSendHours: [9, 9, 14] }, params));
    expect(s.severity).toBe("advice");
    expect(s.rationale).toContain("in the 2 hours from 09:00, when recent campaigns started");
    expect(sendHourSuggestions({ hourly, quietHours: null, recentSendHours: [19, 19] }, params)).toEqual([]);
  });

  it("never suggests a window starting in quiet hours", () => {
    const hourly = hours(5, { 17: 40, 18: 40, 20: 90, 21: 90 });
    const quietHours = { start: "19:30", end: "07:00" };
    expect(inQuietHours(20, quietHours)).toBe(true);
    expect(inQuietHours(19, quietHours)).toBe(false);
    expect(bestSendWindow({ hourly, quietHours, recentSendHours: [] }, 2)).toEqual({ start: 19, visits: 5 + 95 });
    const s = only(sendHourSuggestions({ hourly, quietHours: { start: "19:00", end: "07:00" }, recentSendHours: [] }, params));
    expect(s.title).toContain("17:00–19:00");
    expect(s.rationale).toContain("No window starting in your quiet hours (19:00–07:00) is suggested.");
  });

  it("marks use spread over the day as weak", () => {
    const s = only(sendHourSuggestions({ hourly: hours(10, { 20: 2 }), quietHours: null, recentSendHours: [] }, params));
    expect(s.strength).toBe("weak");
    expect(s.title).toMatch(/^MyHealth use is spread over the day/);
  });

  it("counts windows across midnight and keeps the most recent hour on a tie", () => {
    expect(windowVisits(hours(0, { 23: 3, 0: 4 }), 23, 2)).toBe(7);
    expect(usualSendHour([10, 9, 9, 10])).toBe(10);
    expect(usualSendHour([])).toBeNull();
  });
});

describe("crm.audience-ideas", () => {
  const params = AUDIENCE_IDEAS_RULE.defaultParameters;
  const returns = { returns: 400, days: 140 };

  it("offers a recall audience from the organization's own return time", () => {
    const idea = only(audienceIdeas({ today: "2026-11-10", returns, segments: [] }, params));
    expect(idea).toMatchObject({ key: "recall:5", name: "Not seen in 5 months", criteria: { noVisitForMonths: 5 }, basis: "statistic" });
    expect(idea.why).toContain("75% of your patients who came back did so within 140 days");
    expect(segmentDraftHref(idea)).toBe("/outreach?segment=new&name=Not+seen+in+5+months&noVisitForMonths=5#segments");
  });

  it("offers no recall audience without enough returns or when a segment already selects by the last visit", () => {
    expect(audienceIdeas({ today: "2026-11-10", returns: { returns: 10, days: 140 }, segments: [] }, params)).toEqual([]);
    expect(audienceIdeas({ today: "2026-11-10", returns: { returns: 0, days: null }, segments: [] }, params)).toEqual([]);
    expect(audienceIdeas({ today: "2026-11-10", returns, segments: [{ noVisitForMonths: 12 }] }, params)).toEqual([]);
    expect(audienceIdeas({ today: "2026-11-10", returns, segments: [{ lastVisitBefore: "2026-01-01", sex: "female" }] }, params)).toEqual([]);
  });

  it("offers next month's birthdays in the month's last days only, once per month", () => {
    const none = { returns: 0, days: null };
    expect(audienceIdeas({ today: "2026-11-25", returns: none, segments: [] }, params)).toEqual([
      expect.objectContaining({ key: "birthdays:2026-12", name: "Birthdays in December", criteria: { birthMonth: 12 } }),
    ]);
    expect(audienceIdeas({ today: "2026-11-15", returns: none, segments: [] }, params)).toEqual([]);
    expect(audienceIdeas({ today: "2026-12-28", returns: none, segments: [] }, params)[0]).toMatchObject({
      key: "birthdays:2027-01",
      criteria: { birthMonth: 1 },
    });
    expect(audienceIdeas({ today: "2026-11-25", returns: none, segments: [{ birthMonth: 12 }] }, params)).toEqual([]);
    expect(audienceIdeas({ today: "2026-11-30", returns: none, segments: [] }, { ...params, birthdayLeadDays: 0 })).toEqual([]);
  });

  it("suggests only ideas that match enough patients, as a link to the filled-in segment form", () => {
    const ideas = audienceIdeas({ today: "2026-11-25", returns, segments: [] }, params);
    const suggestions = audienceIdeaSuggestions(
      ideas.map((idea) => ({ ...idea, patients: idea.key.startsWith("recall") ? 312 : 4 })),
      params,
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      id: "crm.audience-ideas@1:idea:recall:5",
      title: "Audience idea: Not seen in 5 months (312 patients)",
      severity: "info",
      action: { label: "Create this segment", href: "/outreach?segment=new&name=Not+seen+in+5+months&noVisitForMonths=5#segments" },
    });
    expect(suggestions[0]?.evidence[0]).toMatchObject({ label: "Patients who match today", value: "312" });
  });

  it("turns days into the months a segment takes", () => {
    expect(monthsFromDays(1)).toBe(1);
    expect(monthsFromDays(31)).toBe(2);
    expect(monthsFromDays(100_000)).toBe(120);
  });
});

describe("crm.frequency-load", () => {
  const params = FREQUENCY_LOAD_RULE.defaultParameters;

  it("warns when many patients received many campaigns and no cap is set", () => {
    const s = only(frequencyLoadSuggestions({ patients: 42, mostReceived: 7, cap: null }, params));
    expect(s).toMatchObject({ severity: "advice", title: "42 patients received 4 or more campaigns in 30 days", action: { href: "/outreach/settings" } });
    expect(s.rationale).toMatch(/^No frequency cap is set\./);
    expect(s.evidence.map((e) => e.value)).toEqual(["42", "7", "none"]);
  });

  it("names a cap that allows it, and is silent when the cap already prevents it or too few patients are concerned", () => {
    const loose = only(frequencyLoadSuggestions({ patients: 42, mostReceived: 6, cap: { maxCampaigns: 6, windowDays: 30 } }, params));
    expect(loose.rationale).toContain("Your frequency cap allows 6 in 30 days.");
    expect(frequencyLoadSuggestions({ patients: 42, mostReceived: 6, cap: { maxCampaigns: 2, windowDays: 30 } }, params)).toEqual([]);
    expect(frequencyLoadSuggestions({ patients: 3, mostReceived: 6, cap: null }, params)).toEqual([]);
  });
});
