/**
 * Demo fixtures used by Storybook and the prototype apps.
 * Not real patient data.
 */
import type {
  Appointment,
  AuditEntry,
  CarePlan,
  DentalChart,
  Encounter,
  Facility,
  LabOrder,
  LabTrendPoint,
  Patient,
  PrescriptionItem,
  Provider,
  QueueEntry,
  TimelineEvent,
  VitalSigns,
} from "./types";

export const mariaSantos: Patient = {
  id: "p-10293",
  mrn: "10293",
  givenName: "Maria",
  familyName: "Santos",
  birthDate: "1988-03-14",
  sex: "female",
  bloodType: "O+",
  phone: "+63 917 555 0142",
  philHealth: { number: "12-345678901-2", verified: true },
  allergies: [
    { id: "a1", substance: "Penicillin", reaction: "Urticaria, angioedema", severity: "severe" },
    { id: "a2", substance: "Shellfish", reaction: "Itching", severity: "mild" },
  ],
  medications: [
    { id: "m1", name: "Losartan", dose: "50 mg", frequency: "OD", route: "PO", startedOn: "2025-11-02", prescriber: "Dr. Reyes", status: "active" },
    { id: "m2", name: "Metformin", dose: "500 mg", frequency: "BID", route: "PO", startedOn: "2026-02-18", prescriber: "Dr. Reyes", status: "active" },
    { id: "m3", name: "Atorvastatin", dose: "20 mg", frequency: "HS", route: "PO", startedOn: "2026-02-18", prescriber: "Dr. Reyes", status: "active" },
  ],
  problems: [
    { id: "pr1", code: "I10", description: "Essential hypertension", onset: "2025-10", status: "active" },
    { id: "pr2", code: "E11.9", description: "Type 2 diabetes mellitus", onset: "2026-02", status: "active" },
    { id: "pr3", code: "E78.5", description: "Dyslipidemia", onset: "2026-02", status: "active" },
  ],
};

export const juanCruz: Patient = {
  id: "p-10311",
  mrn: "10311",
  givenName: "Juan",
  familyName: "Cruz",
  birthDate: "1971-07-02",
  sex: "male",
  bloodType: "A+",
  philHealth: { number: "12-998877665-1", verified: false },
  allergies: [],
  medications: [{ id: "m1", name: "Amlodipine", dose: "5 mg", frequency: "OD", status: "active" }],
  problems: [{ id: "pr1", code: "I10", description: "Essential hypertension", status: "active" }],
};

export const anaReyes: Patient = {
  id: "p-10354",
  mrn: "10354",
  givenName: "Ana",
  familyName: "Reyes",
  birthDate: "1995-12-21",
  sex: "female",
  bloodType: "B+",
  allergies: [{ id: "a1", substance: "Sulfonamides", reaction: "Rash", severity: "moderate" }],
  medications: [],
  problems: [],
};

export const pedroTan: Patient = {
  id: "p-10402",
  mrn: "10402",
  givenName: "Pedro",
  familyName: "Tan",
  birthDate: "1959-05-30",
  sex: "male",
  bloodType: "AB+",
  allergies: [],
  medications: [{ id: "m1", name: "Tamsulosin", dose: "0.4 mg", frequency: "HS", status: "active" }],
  problems: [{ id: "pr1", code: "N40", description: "Benign prostatic hyperplasia", status: "active" }],
};

export const patients: Patient[] = [mariaSantos, juanCruz, anaReyes, pedroTan];

export const latestVitals: VitalSigns = {
  recordedAt: "2026-09-27T09:31:00+08:00",
  systolic: 142,
  diastolic: 91,
  heartRate: 84,
  respiratoryRate: 18,
  temperatureC: 36.8,
  spo2: 98,
  weightKg: 68.4,
  heightCm: 158,
};

export const currentEncounter: Encounter = {
  id: "e-5501",
  patientId: mariaSantos.id,
  type: "consultation",
  status: "in-progress",
  date: "2026-09-27T09:40:00+08:00",
  provider: "Dr. Elena Reyes",
  facility: "Main Clinic",
  reason: "Hypertension and diabetes follow-up",
  note: {
    chiefComplaint: "Occasional morning headaches for 2 weeks.",
    hpi: "38F with HTN and T2DM. Reports good adherence to losartan and metformin. Headaches mild, occipital, resolve by midday. No visual changes, chest pain, or dyspnea.",
    examination: "",
    diagnosis: "",
    plan: "",
  },
  diagnoses: [{ code: "I10", display: "Essential hypertension", primary: true }],
};

export const encounters: Encounter[] = [
  currentEncounter,
  {
    id: "e-5410",
    patientId: mariaSantos.id,
    type: "follow-up",
    status: "completed",
    date: "2026-08-22T10:15:00+08:00",
    provider: "Dr. Elena Reyes",
    facility: "Main Clinic",
    reason: "Diabetes follow-up",
    diagnoses: [{ code: "E11.9", display: "Type 2 diabetes mellitus", primary: true }],
  },
  {
    id: "e-5302",
    patientId: mariaSantos.id,
    type: "telemedicine",
    status: "completed",
    date: "2026-07-18T14:00:00+08:00",
    provider: "Dr. Elena Reyes",
    facility: "Telemedicine",
    reason: "Medication review",
  },
  {
    id: "e-5188",
    patientId: mariaSantos.id,
    type: "dental",
    status: "completed",
    date: "2026-08-14T13:30:00+08:00",
    provider: "Dr. Paolo Lim",
    facility: "Dental Clinic",
    reason: "Oral prophylaxis",
  },
];

export const timeline: TimelineEvent[] = [
  { id: "t1", kind: "telemedicine", date: "2026-09-27T08:10:00+08:00", title: "Online Consultation", detail: "Hypertension follow-up" },
  { id: "t2", kind: "lab", date: "2026-09-27T07:45:00+08:00", title: "Laboratory", detail: "HbA1c — 7.1%", flag: "abnormal" },
  { id: "t3", kind: "prescription", date: "2026-09-20T11:00:00+08:00", title: "Prescription", detail: "Metformin 500 mg BID issued" },
  { id: "t4", kind: "encounter", date: "2026-08-22T10:15:00+08:00", title: "Follow-up", detail: "Diabetes follow-up — Dr. Reyes" },
  { id: "t5", kind: "dental", date: "2026-08-14T13:30:00+08:00", title: "Dental", detail: "Cleaning (oral prophylaxis)" },
  { id: "t6", kind: "billing", date: "2026-08-14T14:05:00+08:00", title: "Billing", detail: "Invoice #INV-2291 paid — PhilHealth applied" },
  { id: "t7", kind: "telemedicine", date: "2026-07-18T14:00:00+08:00", title: "Online Consultation", detail: "Medication review" },
];

export const cbcOrder: LabOrder = {
  id: "lo-1",
  accession: "L-102391",
  patientId: mariaSantos.id,
  patientName: "Maria Santos",
  patientAge: 38,
  patientSex: "female",
  test: "CBC",
  department: "hematology",
  priority: "routine",
  status: "processing",
  orderedAt: "2026-09-27T09:20:00+08:00",
  orderedBy: "Dr. Elena Reyes",
  specimen: { id: "s-1", type: "blood", container: "EDTA", collectedAt: "2026-09-27T09:42:00+08:00", receivedAt: "2026-09-27T09:55:00+08:00" },
  observations: [
    { id: "o1", code: "718-7", name: "Hemoglobin", value: 12.4, unit: "g/dL", referenceLow: 12, referenceHigh: 16, flag: "normal" },
    { id: "o2", code: "4544-3", name: "Hematocrit", value: 37.1, unit: "%", referenceLow: 36, referenceHigh: 46, flag: "normal" },
    { id: "o3", code: "6690-2", name: "WBC", value: 8.2, unit: "×10⁹/L", referenceLow: 4, referenceHigh: 10, flag: "normal" },
    { id: "o4", code: "777-3", name: "Platelets", value: 210, unit: "×10⁹/L", referenceLow: 150, referenceHigh: 400, flag: "normal" },
    { id: "o5", code: "770-8", name: "Neutrophils", value: 72, unit: "%", referenceLow: 40, referenceHigh: 70, flag: "high" },
  ],
};

export const labWorklist: LabOrder[] = [
  cbcOrder,
  {
    id: "lo-2",
    accession: "L-102392",
    patientId: juanCruz.id,
    patientName: "Juan Cruz",
    patientAge: 55,
    patientSex: "male",
    test: "HbA1c",
    department: "chemistry",
    priority: "routine",
    status: "received",
    orderedAt: "2026-09-27T09:25:00+08:00",
    orderedBy: "Dr. Elena Reyes",
    specimen: { id: "s-2", type: "blood", container: "EDTA", collectedAt: "2026-09-27T09:48:00+08:00" },
    observations: [{ id: "o1", code: "4548-4", name: "HbA1c", value: "", unit: "%", referenceHigh: 5.7, referenceText: "< 5.7", flag: "normal" }],
  },
  {
    id: "lo-3",
    accession: "L-102393",
    patientId: anaReyes.id,
    patientName: "Ana Reyes",
    patientAge: 30,
    patientSex: "female",
    test: "Lipid Profile",
    department: "chemistry",
    priority: "routine",
    status: "verified",
    orderedAt: "2026-09-27T08:02:00+08:00",
    orderedBy: "Dr. Marco Dizon",
    specimen: { id: "s-3", type: "serum", container: "SST", collectedAt: "2026-09-27T08:15:00+08:00" },
    observations: [
      { id: "o1", code: "2093-3", name: "Total cholesterol", value: 182, unit: "mg/dL", referenceHigh: 200, referenceText: "< 200", flag: "normal" },
      { id: "o2", code: "2571-8", name: "Triglycerides", value: 131, unit: "mg/dL", referenceHigh: 150, referenceText: "< 150", flag: "normal" },
      { id: "o3", code: "2085-9", name: "HDL", value: 52, unit: "mg/dL", referenceLow: 40, referenceText: "> 40", flag: "normal" },
      { id: "o4", code: "13457-7", name: "LDL (calc)", value: 104, unit: "mg/dL", referenceHigh: 130, referenceText: "< 130", flag: "normal" },
    ],
  },
  {
    id: "lo-4",
    accession: "L-102394",
    patientId: pedroTan.id,
    patientName: "Pedro Tan",
    patientAge: 67,
    patientSex: "male",
    test: "Urinalysis",
    department: "microscopy",
    priority: "urgent",
    status: "review",
    orderedAt: "2026-09-27T08:40:00+08:00",
    orderedBy: "Dr. Marco Dizon",
    specimen: { id: "s-4", type: "urine", container: "Sterile cup", collectedAt: "2026-09-27T08:58:00+08:00" },
    observations: [
      { id: "o1", code: "5803-2", name: "pH", value: 6.0, referenceLow: 4.5, referenceHigh: 8, flag: "normal" },
      { id: "o2", code: "5811-5", name: "Specific gravity", value: 1.025, referenceLow: 1.005, referenceHigh: 1.03, flag: "normal" },
      { id: "o3", code: "5821-4", name: "WBC", value: 25, unit: "/hpf", referenceHigh: 5, referenceText: "0–5", flag: "high" },
      { id: "o4", code: "5794-3", name: "Nitrite", value: "Positive", referenceText: "Negative", flag: "abnormal" },
    ],
  },
  {
    id: "lo-5",
    accession: "L-102395",
    patientId: juanCruz.id,
    patientName: "Juan Cruz",
    patientAge: 55,
    patientSex: "male",
    test: "Potassium",
    department: "chemistry",
    priority: "stat",
    status: "awaiting-verification",
    orderedAt: "2026-09-27T09:05:00+08:00",
    orderedBy: "Dr. Elena Reyes",
    specimen: { id: "s-5", type: "serum", container: "SST", collectedAt: "2026-09-27T09:12:00+08:00" },
    observations: [{ id: "o1", code: "2823-3", name: "Potassium", value: 6.4, unit: "mmol/L", referenceLow: 3.5, referenceHigh: 5.1, flag: "critical-high" }],
  },
  {
    id: "lo-6",
    accession: "L-102396",
    patientId: anaReyes.id,
    patientName: "Ana Reyes",
    patientAge: 30,
    patientSex: "female",
    test: "FBS",
    department: "chemistry",
    priority: "routine",
    status: "rejected",
    orderedAt: "2026-09-27T07:30:00+08:00",
    orderedBy: "Dr. Marco Dizon",
    specimen: { id: "s-6", type: "plasma", container: "NaF", collectedAt: "2026-09-27T07:41:00+08:00", rejectedReason: "Hemolyzed" },
    observations: [],
  },
];

export const hba1cTrend: LabTrendPoint[] = [
  { date: "2026-02-18", value: 8.4 },
  { date: "2026-04-20", value: 7.9 },
  { date: "2026-06-22", value: 7.4 },
  { date: "2026-09-27", value: 7.1 },
];

export const carePlan: CarePlan = {
  id: "cp-1",
  title: "Hypertension & diabetes management",
  condition: "I10, E11.9",
  startedOn: "2026-02-18",
  reviewOn: "2026-10-27",
  goals: [
    { id: "g1", description: "Blood pressure below target", target: "< 130/80 mmHg", due: "2026-12-31", status: "in-progress" },
    { id: "g2", description: "Glycemic control", target: "HbA1c < 7.0%", due: "2026-12-31", status: "in-progress" },
    { id: "g3", description: "Annual dilated eye exam", due: "2026-06-30", status: "missed" },
    { id: "g4", description: "Smoking cessation counselling", status: "achieved" },
    { id: "g5", description: "Weight reduction 5%", target: "≤ 65 kg", due: "2027-02-18", status: "not-started" },
  ],
};

export const appointments: Appointment[] = [
  {
    id: "ap1",
    patientId: mariaSantos.id,
    patientName: "Maria Santos",
    provider: "Dr. Elena Reyes",
    start: "2026-09-27T09:30:00+08:00",
    durationMin: 20,
    type: "consultation",
    mode: "in-person",
    status: "in-progress",
    reason: "HTN/DM follow-up",
  },
  {
    id: "ap2",
    patientId: juanCruz.id,
    patientName: "Juan Cruz",
    provider: "Dr. Elena Reyes",
    start: "2026-09-27T10:00:00+08:00",
    durationMin: 20,
    type: "follow-up",
    mode: "in-person",
    status: "arrived",
    reason: "BP check",
  },
  {
    id: "ap3",
    patientId: anaReyes.id,
    patientName: "Ana Reyes",
    provider: "Dr. Elena Reyes",
    start: "2026-09-27T10:30:00+08:00",
    durationMin: 15,
    type: "telemedicine",
    mode: "online",
    status: "booked",
    reason: "Rash review",
  },
  {
    id: "ap4",
    patientId: pedroTan.id,
    patientName: "Pedro Tan",
    provider: "Dr. Elena Reyes",
    start: "2026-09-27T11:00:00+08:00",
    durationMin: 20,
    type: "consultation",
    mode: "in-person",
    status: "booked",
    reason: "Urinary symptoms",
  },
];

export const queue: QueueEntry[] = [
  { id: "q1", ticket: "C-014", patientName: "Maria Santos", station: "Room 3 · Dr. Reyes", status: "with-provider", arrivedAt: "2026-09-27T09:12:00+08:00" },
  { id: "q2", ticket: "C-015", patientName: "Juan Cruz", station: "Triage", status: "vitals", arrivedAt: "2026-09-27T09:31:00+08:00", priority: "senior" },
  {
    id: "q3",
    ticket: "C-016",
    patientName: "Lorna Bautista",
    station: "Waiting area",
    status: "waiting",
    arrivedAt: "2026-09-27T09:40:00+08:00",
    priority: "pregnant",
  },
  { id: "q4", ticket: "C-017", patientName: "Ramon Garcia", station: "Waiting area", status: "waiting", arrivedAt: "2026-09-27T09:44:00+08:00" },
  { id: "q5", ticket: "C-011", patientName: "Grace Villanueva", station: "Cashier", status: "for-billing", arrivedAt: "2026-09-27T08:30:00+08:00" },
  { id: "q6", ticket: "C-009", patientName: "Nestor Aquino", station: "—", status: "done", arrivedAt: "2026-09-27T08:05:00+08:00" },
];

export const prescriptionDraft: PrescriptionItem[] = [
  { id: "rx1", drug: "Losartan", strength: "100 mg", form: "tablet", sig: "1 tab PO once daily", quantity: 30, refills: 2 },
  { id: "rx2", drug: "Metformin", strength: "500 mg", form: "tablet", sig: "1 tab PO twice daily with meals", quantity: 60, refills: 2 },
];

export const dentalChart: DentalChart = {
  "16": { tooth: "16", findings: [{ condition: "restoration", surfaces: ["O"] }] },
  "26": { tooth: "26", findings: [{ condition: "crown", surfaces: [] }] },
  "36": { tooth: "36", findings: [{ condition: "caries", surfaces: ["M", "O"] }], note: "Moderate caries, schedule restoration." },
  "38": { tooth: "38", findings: [{ condition: "missing", surfaces: [] }] },
  "46": {
    tooth: "46",
    findings: [
      { condition: "crown", surfaces: [] },
      { condition: "root_canal", surfaces: [] },
    ],
  },
  "48": { tooth: "48", findings: [{ condition: "impacted", surfaces: [] }], note: "Impacted, refer to OMFS." },
  "11": { tooth: "11", findings: [] },
};

export const auditHistory: AuditEntry[] = [
  { id: "au1", at: "2026-09-27T09:41:12+08:00", actor: "Dr. Elena Reyes", action: "viewed", target: "Patient record" },
  { id: "au2", at: "2026-09-27T09:38:40+08:00", actor: "Nurse Joy Mercado", action: "created", target: "Vital signs", detail: "BP 142/91, HR 84" },
  { id: "au3", at: "2026-09-27T07:52:03+08:00", actor: "MT Carlo Santos", action: "verified", target: "HbA1c result", detail: "7.1%" },
  { id: "au4", at: "2026-09-20T11:02:55+08:00", actor: "Dr. Elena Reyes", action: "signed", target: "Prescription RX-8812" },
];

export const providers: Provider[] = [
  { id: "pv1", name: "Dr. Elena Reyes", specialty: "Internal Medicine" },
  { id: "pv2", name: "Dr. Marco Dizon", specialty: "Family Medicine" },
  { id: "pv3", name: "Dr. Paolo Lim", specialty: "General Dentistry" },
];

export const facilities: Facility[] = [
  { id: "f1", name: "Main Clinic", kind: "clinic" },
  { id: "f2", name: "Central Laboratory", kind: "laboratory" },
  { id: "f3", name: "Dental Clinic", kind: "dental" },
];

export const diagnosisCatalog = [
  { code: "I10", display: "Essential hypertension" },
  { code: "E11.9", display: "Type 2 diabetes mellitus without complications" },
  { code: "E78.5", display: "Hyperlipidemia, unspecified" },
  { code: "J06.9", display: "Acute upper respiratory infection, unspecified" },
  { code: "N39.0", display: "Urinary tract infection, site not specified" },
  { code: "R51", display: "Headache" },
  { code: "K02.9", display: "Dental caries, unspecified" },
  { code: "M54.5", display: "Low back pain" },
];
