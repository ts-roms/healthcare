import {
  durationWords,
  type OpenLabItem,
  QC_TREND_RULE,
  qcDrift,
  type QcSeries,
  qcShift,
  qcTrendSuggestions,
  REJECTION_RATE_RULE,
  rejectionRateSuggestions,
  TURNAROUND_RISK_RULE,
  turnaroundLimit,
  turnaroundRiskSuggestions,
} from "./lab-quality.rules";

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  return items[0] as T;
}

const asOf = "2026-11-20T08:00:00.000Z";
const hoursBefore = (hours: number) => new Date(Date.parse(asOf) - hours * 3_600_000).toISOString();
const item = (id: string, values: Partial<OpenLabItem> = {}): OpenLabItem => ({
  orderItemId: id,
  orderNumber: `L-${id}`,
  testId: "cbc",
  testName: "Complete blood count",
  stat: false,
  collectedAt: hoursBefore(1),
  stage: "enter",
  ...values,
});

describe("durations in words", () => {
  it("reads minutes, hours and days", () => {
    expect(durationWords(45)).toBe("45 min");
    expect(durationWords(120)).toBe("2 h");
    expect(durationWords(130)).toBe("2 h 10 min");
    expect(durationWords(2880)).toBe("2 days");
    expect(durationWords(3000)).toBe("2 days 2 h");
  });
});

describe("laboratory.turnaround-risk", () => {
  const params = TURNAROUND_RISK_RULE.defaultParameters;
  const usual = [
    { testId: "cbc", stat: false, medianMinutes: 120, releases: 40 },
    { testId: "cbc", stat: true, medianMinutes: 45, releases: 25 },
    { testId: "cbc", stat: null, medianMinutes: 100, releases: 65 },
    { testId: "fbs", stat: true, medianMinutes: 30, releases: 3 },
    { testId: "fbs", stat: null, medianMinutes: 90, releases: 30 },
  ];

  it("measures an item against its test's usual time, STAT apart, else the catalog target", () => {
    const input = { usual, targets: [{ testId: "hba1c", minutes: 1440 }] };
    expect(turnaroundLimit({ testId: "cbc", stat: true }, input, params)).toMatchObject({ minutes: 56.25, basis: "statistic" });
    // Too few STAT releases of FBS: its overall median is used.
    expect(turnaroundLimit({ testId: "fbs", stat: true }, input, params)?.minutes).toBe(112.5);
    expect(turnaroundLimit({ testId: "hba1c", stat: false }, input, params)).toEqual({
      minutes: 1440,
      basis: "rule",
      text: "The catalog's turnaround target is 24 h",
    });
    expect(turnaroundLimit({ testId: "esr", stat: false }, input, params)).toBeNull();
  });

  it("groups the orders past their usual time by test, longest first, with where each waits", () => {
    const input = {
      usual,
      targets: [],
      items: [
        item("1", { collectedAt: hoursBefore(5), stage: "verify" }),
        item("2", { collectedAt: hoursBefore(3), stage: "verify" }),
        item("3", { collectedAt: hoursBefore(1), stage: "enter" }),
      ],
    };
    const s = only(turnaroundRiskSuggestions(input, params, asOf, "2026-11-20"));
    expect(s).toMatchObject({
      id: "laboratory.turnaround-risk@1:test:cbc:2026-11-20",
      surface: "laboratory",
      severity: "warning",
      title: "Complete blood count: 2 orders past the usual turnaround (longest 5 h since collection)",
      basis: "statistic",
      action: { label: "Open the worklist", href: "/laboratory/worklist?stage=verify" },
    });
    expect(s.rationale).toMatch(/^Usually released within 2 h of collection here \(the median of 40 releases in 60 days\); at risk past 2 h 30 min\./);
    expect(s.evidence.map((e) => [e.label, e.value])).toEqual([
      ["Order L-1", "5 h since collection, waiting for verification"],
      ["Order L-2", "3 h since collection, waiting for verification"],
    ]);
  });

  it("is advice when nothing is STAT or twice past its time, and silent when every order is on time", () => {
    const input = { usual, targets: [], items: [item("4", { collectedAt: hoursBefore(2.75) })] };
    expect(only(turnaroundRiskSuggestions(input, params, asOf, "2026-11-20")).severity).toBe("advice");
    expect(turnaroundRiskSuggestions({ usual, targets: [], items: [item("5")] }, params, asOf, "2026-11-20")).toEqual([]);
  });
});

describe("laboratory.qc-trend", () => {
  const params = QC_TREND_RULE.defaultParameters;
  const series = (zs: number[]): QcSeries => ({
    instrumentId: "ins-1",
    instrumentName: "Analyzer 1",
    testId: "glu",
    testName: "Glucose",
    qcLotId: "lot-1",
    materialName: "Chemistry control",
    level: "Level 1",
    lotNumber: "L1",
    runs: zs.map((z, i) => ({ runAt: new Date(Date.parse("2026-11-01T00:00:00Z") + i * 86_400_000).toISOString(), z, status: "accepted" as const })),
  });

  it("finds a drift and a shift", () => {
    expect(qcDrift([0.1, 0.3, 0.5, 0.8, 1.0, 1.3], 6)).toBe("up");
    expect(qcDrift([0.5, 0.3, 0.1, -0.2, -0.4, -0.9], 6)).toBe("down");
    expect(qcDrift([0.1, 0.3, 0.3, 0.8, 1.0, 1.3], 6)).toBeNull();
    expect(qcDrift([0.1, 0.3], 6)).toBeNull();
    expect(qcShift([1.2, 0.9, 1.1, 1.0, 1.3, 0.8, 1.2, 1.1, 0.9, 1.0], 10, 1)).toBeCloseTo(1.05);
    expect(qcShift([1.2, -0.9, 1.1, -1.0, 1.3, -0.8, 1.2, -1.1, 0.9, -1.0], 10, 1)).toBeNull();
  });

  it("names the series and shows the runs, a warning when it both drifts and shifted", () => {
    const s = only(qcTrendSuggestions([series([0.9, 1.0, 0.8, 1.1, 0.7, 0.8, 1.0, 1.2, 1.4, 1.6])], params, "Asia/Manila"));
    expect(s).toMatchObject({
      severity: "warning",
      surface: "laboratory-quality",
      title:
        "Glucose on Analyzer 1, Chemistry control (Level 1) lot L1: drifting up over the last 6 runs; the last 10 runs average +1.1 SD above the target mean",
      action: { label: "Open its Levey-Jennings chart", href: "/laboratory/qc?instrument=ins-1&test=glu#qc-chart" },
    });
    expect(s.evidence.map((e) => e.value)).toEqual(["+0.9, +1.0, +0.8, +1.1, +0.7, +0.8, +1.0, +1.2, +1.4, +1.6", "+1.1 SD", "accepted, 2026-11-10"]);
  });

  it("says nothing about scattered runs", () => {
    expect(qcTrendSuggestions([series([0.4, -0.6, 1.1, -0.2, 0.3, -1.0, 0.5, 0.1, -0.4, 0.2])], params, "Asia/Manila")).toEqual([]);
  });
});

describe("laboratory.rejection-rate", () => {
  const params = REJECTION_RATE_RULE.defaultParameters;
  const collectors = [
    { userId: "u1", displayName: "Ana Cruz", collected: 40, rejected: 8 },
    { userId: "u2", displayName: "Ben Reyes", collected: 100, rejected: 3 },
    { userId: "u3", displayName: "Carla Lim", collected: 60, rejected: 2 },
  ];

  it("points out a collector and the facility whose share stands out, by count only", () => {
    const found = rejectionRateSuggestions({ collectors, others: { collected: 300, rejected: 6 } }, params);
    expect(found.map((s) => s.title)).toEqual([
      "Ana Cruz: 8 of 40 specimens rejected in 30 days (20%), against 3.1% for others here",
      "This facility: 13 of 200 specimens rejected in 30 days (6.5%), against 2% at your other facilities",
    ]);
    expect(found[0]).toMatchObject({ id: "laboratory.rejection-rate@1:collector:u1", strength: "matched", action: { href: "/laboratory/nonconformances" } });
  });

  it("compares no one below the minimum specimens or rejections, and no facility without others", () => {
    expect(rejectionRateSuggestions({ collectors, others: null }, { ...params, minSpecimens: 50 })).toEqual([]);
    expect(rejectionRateSuggestions({ collectors, others: null }, { ...params, minRejections: 9 })).toEqual([]);
  });
});
