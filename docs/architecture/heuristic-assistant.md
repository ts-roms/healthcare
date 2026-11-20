# Heuristic assistant — plan

**Status:** accepted as ADR-0018 (2026-11-20). Phases 0, 1 and 2 are built. Phase 2: the doctor's workspace (consultation checklist, code suggestions, laboratory delta check), integrity and security (unusual record access, compliance areas to review, possible duplicate invoices), order sets and outreach (the organization's order sets offered in a consultation, migration `0155`; when patients use MyHealth, audiences worth a segment and patients receiving many campaigns on the outreach screen), and the staff command bar (Ctrl+K). Phases 3 to 4 are not (`docs/domains/assistant.md`). The MyHealth "What next?" nudges and help search listed under phase 2 were not built as rules: MyHealth shows no assistant, and help search is the command bar's. Phase 1's backtest is the replay behind **Try these values**; its wait estimate became a "waits longer than usual" rule. Help search and triage vital-sign hints already existed outside the assistant; discount outliers were left out (statutory discounts are fixed by rule, and manual ones need a policy first).

## 1. What "heuristic" means here

The assistant is **deterministic and explainable**: hand-written rules, thresholds, scoring and simple statistics (medians, moving averages, z-scores, token and trigram matching) over data the caller may already read. There is no LLM and no trained model, and no patient data leaves the platform. Every suggestion names the rule that produced it and the records it looked at, so a reader can check it by hand.

It is **decision support** (CLAUDE.md §35). It never writes clinical data, never decides, always allows an override or dismissal, and says when the evidence is thin. Its only action is a deep link to the existing screen that does the work, where the existing permission checks, audit and version checks apply unchanged.

Assumption: "AI assistant" means this suggestion layer. If a model-based provider is wanted later, the `SuggestionProvider` port (section 3) is the seam; that would need its own ADR and a privacy review.

## 2. Principles

1. **Rules live in the domain, composition lives in the API.** A pure rule function sits beside the domain code it reads (`libs/<domain>/src/lib/assistant/*.rules.ts`, unit-tested like `allergy-check.ts` and `laboratory.rules.ts`). Cross-domain suggestions are composed in `apps/api/src/app/assistant`, like Patient 360 (ADR-0011: no `libs/reporting` or `libs/assistant` until a second process needs the same rules).
2. **Thresholds belong to the organization.** No clinical cut-off, triage scale, drug interaction list or regulatory rule is shipped as fact (CLAUDE.md §36). A rule that needs a number reads it from `assistant_rule_setting`, and stays off until set.
3. **Off by default, per rule, per organization and facility.** Turning a rule on is an `org_admin` decision.
4. **Least privilege.** A suggestion is built only from sources the caller can read; each carries the permission it needs. Withheld sources are listed as "Not available to you", never counted.
5. **Content-free outside the screen.** Events, audit values, notifications and push carry ids and rule ids, never findings or free text.
6. **Evidence or silence.** No evidence list, no suggestion. Confidence is a band (`rule matched`, `weak signal`) and never a made-up percentage.
7. **Self-limiting.** Dismissals are recorded; a rule that is dismissed too often is flagged to the administrator, never tuned silently.

## 3. Shared kernel (`libs/core/src/lib/assistant/`)

```
Suggestion {
  id            // ruleId + ruleVersion + subject key (stable, so a dismissal sticks)
  ruleId, ruleVersion
  surface       // where it appears: 'encounter' | 'queue' | 'billing' | ...
  severity      // 'info' | 'advice' | 'warning'   (colour + icon + text, never colour alone)
  title, rationale
  evidence[]    // { label, resourceType, resourceId, value? }  value only when the caller may read it
  basis         // 'rule' | 'statistic' | 'text-match'
  strength      // 'matched' | 'weak'
  requires[]    // permissions needed to see it
  action?       // deep link only
  expiresAt?
}
Rule<Ctx> { id, version, domain, defaultEnabled: false, evaluate(ctx, settings): Suggestion[] }
```

- `SuggestionProvider` port: `suggest(actor, surface, subject) => Suggestion[]`. The only implementation is the rule registry.
- Shared helpers: robust median and percentile, moving average, z-score with a minimum sample size, token and trigram similarity, synonym maps, "not enough data" results (a rule with too little history returns nothing).
- Registry with unique `ruleId`, semantic version, and a docs entry per rule (purpose, inputs, setting names, known false positives).

## 4. Persistence and API

Migration `0152` (hand-written SQL, composite same-organization keys, RLS policy):

- `assistant_rule_setting`: organization, facility (nullable), rule id, enabled, JSON parameters validated by the rule's Zod schema, version, `updated_by`. Versioned, append-only history.
- `assistant_feedback`: append-only (trigger): actor, rule id and version, subject key, `accepted | dismissed | not_useful`, optional reason. Suggestions themselves are computed on demand, not stored.
- Permissions (catalog and migration rows): `assistant.use`, `assistant.configure`, `assistant.insights.read`.

API under `/api/v1/assistant`:

- `GET /suggestions?surface=&subjectType=&subjectId=` (`assistant.use`): composes the registry for the caller's facility, filters out suppressed and withheld ones. One audit per request: `assistant.view`, rule ids only.
- `POST /suggestions/:id/feedback`, `GET|PUT /settings` (`assistant.configure`, version-checked), `GET /insights` (`assistant.insights.read`: per rule shown, acted on, dismissed, with a "review this rule" flag).
- Event `AssistantSuggestionActedOn` (ids only).

UI: one `AssistantPanel` and `SuggestionCard` in `libs/ui/src/healthcare`, labelled "Suggestion — decision support", with "Why?" (evidence), **Dismiss** and a reason field. Business rules stay out of React. Each surface mounts the panel with its own `surface` key.

## 5. Features by domain

Phase in brackets. Every item is a rule or statistic, not a model.

**Clinic and queue**

- [1] No-show risk on the day schedule: the patient's own past no-show share, lead time, weekday, reminder confirmed. Suggests a reminder call or an overbook slot; nothing is cancelled or double-booked automatically.
- [1] Wait estimate for the queue: median of recent same-visit-type waits at the facility, shown with sample size.
- [2] Encounter completeness checklist before signing: chief complaint, vitals present, diagnosis coded, follow-up plan, allergy review status.
- [2] Diagnosis code suggestion: tokens and trigrams of the typed assessment against the active coding system's descriptions (text match, shows the matching words, never auto-selects).
- [2] Triage hint: the organization's own vital-sign bands may raise "review priority"; stays off until the facility enters them.
- [3] Recall and care-plan: overdue activity, next due, gaps between a diagnosis and a configured monitoring test.

**Prescribing and pharmacy**

- [3] Duplicate therapy (same ingredient or organization-defined class), repeat within N days, dose above the organization's entered maximum, missing renal or pregnancy note when the organization marks the drug. Complements `allergy-check.ts`; nothing replaces it.
- [3] Dispensing: short stock, nearest-expiry lot first (FEFO already), controlled-item reason missing.

**Laboratory**

- [2] Delta check on entry: change versus the patient's last released value beyond the organization's percentage or absolute limit.
- [2] Order sets: tests an organization linked to a diagnosis or visit type, offered as one click to add to the order (the clinician confirms).
- [3] Turnaround at risk: open orders whose elapsed time exceeds the test's median plus a margin.
- [3] Quality: trend rules over QC data beyond Westgard (drift, shift), rejection rate by collector or site.

**Dental**

- [3] Chart consistency: a planned procedure on a tooth charted as missing, surface not valid, plan items not yet decided, recall interval due.

**Billing**

- [1] Missing charge: completed procedure, dispensing or dental work with no charge after a delay.
- [2] Claim readiness reasons (extends the existing PhilHealth readiness checks), discount outside the usual range for that cashier, possible duplicate invoice.

**Inventory**

- [1] Reorder quantity and days-of-cover from the moving average of issues; usage spike (z-score) per item; expiry exposure.

**Outreach (CRM)**

- [2] Candidate segments from non-clinical criteria only (never a diagnosis), best send hour from past booking and open patterns, frequency-cap warnings.

**Patient portal (MyHealth)**

- [2] "What next?" nudges: pending forms, unpaid bills, unbooked follow-up.
- [3] Result wording: a fixed, reviewed explanation of "within / outside the reference range" with the clinic's range. No interpretation of what a value means for a person's health, and critical results stay with the care team.
- [2] Help search over `docs/manual` (BM25 with synonyms), which also feeds the staff command bar.
- Not built: a symptom checker. Telemedicine red flags remain the organization's own questionnaire rules.

**Telemedicine**

- [3] Escalation hint from questionnaire answers and the organization's red-flag list; the provider decides.

**Admin and security**

- [2] Unusual access: one user opening many distinct patient records in a short window, off-hours access, repeated denials. Reported to administrators for review; nothing blocks.
- [2] Configuration gaps: compliance areas never reviewed, rules off that other settings depend on, duplicate-patient backlog.

**Staff command bar**

- [2] Intent grammar over keywords and synonyms ("book Santos", "lab results today") that finds the patient or screen and opens it. Respects navigation permissions.

## 6. Delivery phases

| Phase | Scope                                                                                                                                                             | Exit                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0     | ADR-0018, kernel, migration `0152`, API, `AssistantPanel`, `docs/domains/assistant.md`, first rule (inventory reorder) end to end                                 | Integration test through the real API; Storybook story    |
| 1     | Operational rules: no-show risk, queue wait estimate, missing charge, inventory forecasts                                                                         | Backtest on `pnpm db:seed:demo` data; acceptance recorded |
| 2     | Documentation and data quality: encounter checklist, code suggestions, delta checks, order sets, outreach segments, access anomalies, help search and command bar | Dismissal rate per rule under review                      |
| 3     | Prescribing, dental, telemedicine, laboratory timing and portal wording                                                                                           | Clinical review of each rule by a physician or pharmacist |
| 4     | Governance: insights page, rule retirement, documented false positives                                                                                            | Quarterly rule review is a runbook                        |

## 7. Testing and validation

- **Unit:** each rule with fixtures: matched, not matched, too little data, setting missing (returns nothing).
- **Integration:** permission gating (a withheld source is never leaked into evidence), organization isolation (RLS), suppression after dismissal, audit written without values.
- **Backtest harness:** replays a rule over historical rows and reports how often it would have fired, so a threshold is chosen from data before it goes on.
- **E2E:** one journey per phase (a suggestion appears, "Why?" shows evidence, dismissal sticks).
- **Safety review:** every clinical rule is signed off by a clinician before default-on in any organization; none is default-on in the product.

## 8. Risks and compliance

- Over-alerting breeds alert fatigue: cap suggestions per surface (3 visible), group by severity, and report dismissal rates.
- Wrong confidence: bands only, with "based on N records".
- Clinical liability: wording is "consider" or "check", never "diagnosis"; no autonomous writes.
- Data Privacy Act: no new data collected beyond feedback; add a row to `docs/security/compliance-dependencies.md` for whether staff-behaviour analytics (access anomalies, cashier discounts) need a notice to staff.
- Rules built from published guidelines are the organization's to validate; none is claimed to be compliant or certified.

## 9. Open decisions

1. Does the first release include the staff command bar and portal help search, or only suggestions on clinical and operational screens?
2. Is staff-behaviour analytics (access anomalies, discount outliers) acceptable under the organization's policy and notice?
3. Who signs off clinical rules (a medical director role in the compliance register)?
