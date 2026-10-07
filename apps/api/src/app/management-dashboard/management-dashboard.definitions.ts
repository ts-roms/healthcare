import { RETENTION_LOOKBACK_MONTHS, RETURN_WINDOW_DAYS, SMALL_CELL_THRESHOLD } from "./management-dashboard.rules";

/**
 * "How is this calculated?" — one plain-language definition per figure, returned with the dashboard (`definitions`)
 * and shown next to each figure in the staff app. docs/architecture/management-dashboard.md repeats them; keep both in
 * step. Every figure covers the chosen local days at the facilities in scope.
 */
export const METRIC_DEFINITIONS = {
  patientsSeen:
    "Distinct patients with at least one completed consultation (in person, online or dental) completed in the period. Entered-in-error consultations are never counted.",
  newPatients: "Patient records registered in the period at the facilities in scope (the registering facility); records merged into another are left out.",
  returningPatients:
    "Patients seen in the period who had a completed consultation before the period, anywhere in the organization. First-time = seen − returning. Returning rate = returning ÷ seen.",
  consultations: "Consultations (encounters) completed in the period, in person and online. Online = telemedicine modality.",
  noShowRate: "No-shows ÷ appointments booked (appointments starting in the period, cancelled ones excluded from both).",
  averageWait:
    "Average minutes from check-in to the start of the consultation, for visits checked in during the period whose consultation started. The median is the wait half of those visits beat; the 90th percentile is the wait nine in ten beat — neither is swayed by one very long wait the way the average is.",
  utilization:
    "Booked minutes (appointments starting in the period, not cancelled, no-shows included) ÷ available minutes (the practitioner's weekly schedules valid on each day, less leave and facility closures). Can exceed 100% when booked outside the schedule; empty without schedules.",
  invoicedNet:
    "Net total of invoices issued in the period and still valid (voided invoices excluded; credit and debit notes shown separately). Operational, not BIR reporting.",
  collected: "Payments recorded in the period less refunds recorded in the period (deposits and account credit not included).",
  labReleased: "Laboratory tests whose result was first released in the period (a result's first version); later versions are counted as corrections.",
  labTurnaround:
    "Average minutes from specimen collection to the first release, for tests first released in the period. Corrections do not restart the clock. The median and 90th percentile are the turnaround half, and nine in ten, of those tests beat.",
  labDepartments:
    "The same release, turnaround and within-target figures per laboratory department (the department of each test's catalog entry), for tests first released in the period.",
  labWithinTarget:
    "Of the tests first released in the period whose catalog entry has a turnaround target, the share released within it, counted from collection.",
  specimenRejectionRate: "Specimens rejected ÷ specimens collected, for specimens collected in the period (whenever they were rejected).",
  resultsPerInstrument: "First versions of results entered in the period, by the instrument recorded on them (“No instrument recorded” when none).",
  dentalProcedures: "Dental procedures performed in the period, excluding those entered in error; patients = distinct patients treated.",
  telemedicine:
    "Online consultations whose video consultation started in the period, by current status: ended, escalated to in-person care, or still in consultation. Escalation rate = escalated ÷ finished (ended + escalated). Not a quality target.",
  telemedicineWait:
    "For online consultations started in the period, the minutes from the patient joining the waiting room to the consultation starting: average, median and 90th percentile. “Joined, never seen” counts patients who joined the waiting room in the period and whose consultation never started; it is a patient count and is suppressed like one.",
  retentionRate: `Of the patients seen in the period at the facilities in scope, the share who also had a completed consultation there in the ${RETENTION_LOOKBACK_MONTHS} months before the period started.`,
  returnRate: `Cohort: patients seen in the period whose first completed consultation in the period was more than ${RETURN_WINDOW_DAYS} days before today (their follow-up window has fully elapsed). Rate: the share with another completed consultation at the facilities in scope on a later local day, at most ${RETURN_WINDOW_DAYS} days after that first one.`,
  stock:
    "Stock movements recorded in the period at the stock locations of the facilities in scope, valued at the cost each movement recorded when it was posted (the lot's weighted average receipt cost), so figures never shift. Received = receipts (purchases and manual receipts). Used = issues, dispenses, write-offs and count adjustments, net of returns, by the workflow that took the stock; transfers between locations are not use. Quantity without a cost = moved before costs were recorded. Operational figures, not accounting or BIR.",
  dispensing:
    "Prescriptions issued in the period at the facilities in scope (and how many are cancelled or replaced since), dispense lines recorded from prescriptions (a reversed dispense is counted as recorded and again as reversed), distinct prescriptions dispensed and patients served (a patient count, suppressed like one), and the items dispensed most by quantity in their stock unit. Standing dispenses only for items, prescriptions and patients.",
  comparison:
    "The same figure over the comparison period: by default the previous period of equal length ending the day before this one; or, when chosen, the same calendar dates one year earlier (29 February falls back to 28 February). Rates change in percentage points; other figures by their own unit and in percent. “Better” or “worse” follows each figure's direction of improvement; volumes are neither.",
  suppression: `Patient counts from 1 to ${SMALL_CELL_THRESHOLD - 1} are shown as “<${SMALL_CELL_THRESHOLD}” so that no one can be singled out, and a rate built on such a count is withheld. Counts of consultations, tests and procedures, and amounts, are not patient counts.`,
} as const;

export type MetricKey = keyof typeof METRIC_DEFINITIONS;
