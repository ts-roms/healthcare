/**
 * Demo data for presenting the web app (docs/demo/walkthrough.md).
 *
 * Fills the seeded organization (`pnpm db:seed`) with a demo clinic through the public API, so every rule, audit
 * event and domain event applies exactly as it would in use: staff accounts per role, practitioners with weekly
 * schedules, visit types, rooms, service points, a laboratory catalogue, billing services, patients with consents and
 * allergies, today's appointments and queue, a signed consultation with a prescription and released laboratory
 * results, an issued and paid invoice, and a MyHealth account. Safe to run again: what exists is reused.
 *
 * Needs a running API (`pnpm dev:api`) and the admin from `pnpm db:seed`.
 *
 *   API_BASE_URL                       default http://localhost:3333/api/v1
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD   the seeded administrator (required)
 *   DEMO_PASSWORD                      password of every demo account (default: Demo-Clinic-2026)
 *   DEMO_EMAIL_DOMAIN                  default demo.healthcare.ph
 */
const API = (process.env.API_BASE_URL ?? "http://localhost:3333/api/v1").replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Clinic-2026";
const DOMAIN = process.env.DEMO_EMAIL_DOMAIN ?? "demo.healthcare.ph";
const TIME_ZONE = "Asia/Manila";

type Json = Record<string, unknown>;

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly path: string,
  ) {
    super(`${path} → ${status} ${code ?? ""} ${message}`.trim());
  }
}

interface Session {
  token: string;
  facilityId?: string;
}

async function call<T = Json>(
  session: Session | null,
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
  attempt = 0,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Bearer ${session.token}` } : {}),
      ...(session?.facilityId ? { "x-facility-id": session.facilityId } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 429 && attempt < 3) {
    // Sign-in and other guarded routes are rate-limited; wait as told and try again.
    const wait = Math.min(Number(response.headers.get("retry-after") ?? "15") || 15, 90);
    log(`  rate-limited on ${method} ${path}; waiting ${wait}s`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return call(session, method, path, body, extra, attempt + 1);
  }
  const text = await response.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const error = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const details = error?.details ? ` ${JSON.stringify(error.details).slice(0, 400)}` : "";
    throw new ApiError(response.status, error?.code, `${error?.message ?? text.slice(0, 200)}${details}`, `${method} ${path}`);
  }
  return json as T;
}

/** Runs a create; a conflict (already there) answers with `fallback()` instead. */
async function ensure<T>(create: () => Promise<T>, fallback: () => Promise<T | undefined>): Promise<T> {
  try {
    return await create();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
      const existing = await fallback();
      if (existing) return existing;
    }
    throw error;
  }
}

const quietly = async (work: () => Promise<unknown>) => {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof ApiError && (error.status === 409 || error.status === 422))) throw error;
  }
};

function localDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
}

function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** An instant for a Manila wall-clock time on a date (Asia/Manila has no daylight saving: fixed +08:00). */
function manila(date: string, time: string): string {
  return new Date(`${date}T${time}:00+08:00`).toISOString();
}

const log = (line: string) => console.log(line);

const ORG_CODE = process.env.SEED_ORG_CODE ?? "demo";

async function login(email: string, password: string, organizationId?: string): Promise<Session> {
  try {
    const result = await call<{ accessToken: string }>(null, "POST", "/auth/login", { email, password, organizationId });
    return { token: result.accessToken };
  } catch (error) {
    // A member of several organizations chooses one: the seeded organization (SEED_ORG_CODE), else the first.
    if (!(error instanceof ApiError && error.code === "organization_selection_required") || organizationId) throw error;
    const response = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = (await response.json()) as { error?: { details?: { organizations?: Array<{ organizationId?: string; id?: string; code?: string }> } } };
    const organizations = body.error?.details?.organizations ?? [];
    const chosen = organizations.find((o) => o.code === ORG_CODE) ?? organizations[0];
    const id = chosen?.organizationId ?? chosen?.id;
    if (!id) throw error;
    return login(email, password, id);
  }
}

interface Facility {
  id: string;
  code: string;
  name: string;
  timezone: string;
}

// ---- staff --------------------------------------------------------------------------------------------------------

const STAFF = [
  { key: "reception", name: "Liza Mendoza", roles: ["receptionist"] },
  { key: "nurse", name: "Nurse Carlo Dizon", roles: ["nurse"] },
  { key: "dr.santos", name: "Dr. Ana Santos", roles: ["physician"], practitioner: { specialty: "Internal Medicine", license: "0123456" } },
  { key: "dr.reyes", name: "Dr. Miguel Reyes", roles: ["physician"], practitioner: { specialty: "Family Medicine", license: "0234567" } },
  { key: "medtech", name: "Joy Villanueva, RMT", roles: ["medical_technologist", "phlebotomist"] },
  { key: "pathologist", name: "Dr. Elena Cruz", roles: ["pathologist"] },
  { key: "cashier", name: "Ramon Bautista", roles: ["cashier"] },
  { key: "records", name: "Teresa Lim", roles: ["records_officer"] },
  { key: "pharmacist", name: "Grace Navarro, RPh", roles: ["pharmacist"] },
] as const;

type StaffKey = (typeof STAFF)[number]["key"];
const emailOf = (key: string) => `${key}@${DOMAIN}`;

async function seedStaff(admin: Session): Promise<Record<StaffKey, string>> {
  const roles = await call<Array<{ id: string; key: string }>>(admin, "GET", "/roles");
  const roleId = (key: string) => {
    const role = roles.find((r) => r.key === key);
    if (!role) throw new Error(`Built-in role ${key} not found`);
    return role.id;
  };
  const users = await call<Array<{ id: string; email: string }>>(admin, "GET", "/users");
  const ids = {} as Record<StaffKey, string>;
  for (const member of STAFF) {
    const email = emailOf(member.key);
    const user = await ensure(
      () => call<{ id: string }>(admin, "POST", "/users", { email, displayName: member.name, initialPassword: PASSWORD }),
      async () =>
        users.find((u) => u.email === email) ?? (await call<Array<{ id: string; email: string }>>(admin, "GET", "/users")).find((u) => u.email === email),
    );
    ids[member.key] = user.id;
    for (const role of member.roles) await quietly(() => call(admin, "POST", `/users/${user.id}/role-assignments`, { roleId: roleId(role) }));
  }
  log(`Staff: ${STAFF.length} accounts (password ${PASSWORD})`);
  return ids;
}

// ---- clinic configuration -----------------------------------------------------------------------------------------

interface Config {
  visitTypes: Record<string, string>;
  practitioners: Record<string, string>;
  servicePoints: Record<string, string>;
  rooms: Record<string, string>;
}

async function seedClinic(admin: Session, facility: Facility, staff: Record<StaffKey, string>): Promise<Config> {
  const find = async <T extends { code?: string; key?: string }>(path: string, code: string) =>
    (await call<T[]>(admin, "GET", path)).find((row) => row.code === code || row.key === code);
  const visitTypes: Record<string, string> = {};
  for (const type of [
    { code: "consult", name: "Consultation", defaultDurationMinutes: 20, onlineBooking: true },
    { code: "follow-up", name: "Follow-up", defaultDurationMinutes: 15, onlineBooking: true },
    { code: "teleconsult", name: "Online consultation", defaultDurationMinutes: 20, modality: "telemedicine", requiresTriage: false, onlineBooking: true },
  ]) {
    visitTypes[type.code] = (
      await ensure(
        () => call<{ id: string }>(admin, "POST", "/clinic/visit-types", type),
        () => find("/clinic/visit-types", type.code),
      )
    ).id;
  }
  await quietly(() => call(admin, "POST", "/clinic/coding-systems", { key: "icd10", name: "ICD-10", version: "2019" }));

  const rooms: Record<string, string> = {};
  for (const room of [
    { code: "room-1", name: "Room 1", roomType: "consultation" },
    { code: "room-2", name: "Room 2", roomType: "consultation" },
    { code: "triage-1", name: "Triage 1", roomType: "triage" },
  ]) {
    rooms[room.code] = (
      await ensure(
        () => call<{ id: string }>(admin, "POST", "/clinic/rooms", { facilityId: facility.id, ...room }),
        async () =>
          (await call<Array<{ id: string; code: string }>>(admin, "GET", `/clinic/rooms?facilityId=${facility.id}`)).find((r) => r.code === room.code),
      )
    ).id;
  }

  const practitioners: Record<string, string> = {};
  const existing = await call<Array<{ id: string; userId: string | null; displayName: string }>>(admin, "GET", "/clinic/practitioners");
  for (const member of STAFF) {
    if (!("practitioner" in member)) continue;
    const found = existing.find((p) => p.userId === staff[member.key]);
    practitioners[member.key] =
      found?.id ??
      (
        await call<{ id: string }>(admin, "POST", "/clinic/practitioners", {
          displayName: member.name,
          profession: "physician",
          specialty: member.practitioner.specialty,
          licenseNumber: member.practitioner.license,
          userId: staff[member.key],
        })
      ).id;
  }
  // Weekly schedules: Monday to Friday, mornings and afternoons, 20-minute slots; one doctor per room.
  const schedules = await call<Array<{ practitionerId: string; facilityId: string; status: string }>>(admin, "GET", "/clinic/schedules");
  const validFrom = shiftDays(localDate(), -30);
  for (const [i, key] of (["dr.santos", "dr.reyes"] as const).entries()) {
    const id = practitioners[key]!;
    if (schedules.some((s) => s.practitionerId === id && s.facilityId === facility.id && s.status === "active")) continue;
    for (const dayOfWeek of [1, 2, 3, 4, 5]) {
      for (const [startTime, endTime] of [
        ["08:00", "12:00"],
        ["13:00", "17:00"],
      ]) {
        await quietly(() =>
          call(admin, "POST", "/clinic/schedules", {
            practitionerId: id,
            facilityId: facility.id,
            roomId: rooms[i === 0 ? "room-1" : "room-2"],
            dayOfWeek,
            startTime,
            endTime,
            slotMinutes: 20,
            validFrom,
          }),
        );
      }
    }
  }

  const servicePoints: Record<string, string> = {};
  for (const point of [
    { code: "opd", name: "Consultation", kind: "consultation" },
    { code: "er", name: "Emergency room", kind: "emergency" },
    { code: "xray", name: "X-ray", kind: "imaging" },
  ]) {
    servicePoints[point.code] = (
      await ensure(
        () => call<{ id: string }>(admin, "POST", "/clinic/service-points", { facilityId: facility.id, ...point }),
        async () =>
          (await call<Array<{ id: string; code: string }>>(admin, "GET", `/clinic/service-points?facilityId=${facility.id}&includeInactive=true`)).find(
            (s) => s.code === point.code,
          ),
      )
    ).id;
  }
  log("Clinic: visit types, rooms, practitioners with schedules, service points");
  return { visitTypes, practitioners, servicePoints, rooms };
}

// ---- laboratory catalogue -----------------------------------------------------------------------------------------

interface LabCatalog {
  tests: Record<string, string>;
  specimenTypes: Record<string, string>;
}

async function seedLaboratory(admin: Session): Promise<LabCatalog> {
  const find = async (path: string, code: string) => (await call<Array<{ id: string; code: string }>>(admin, "GET", path)).find((r) => r.code === code);
  const departments: Record<string, string> = {};
  for (const d of [
    { code: "chem", name: "Clinical Chemistry" },
    { code: "hema", name: "Hematology" },
  ]) {
    departments[d.code] = (
      await ensure(
        () => call<{ id: string }>(admin, "POST", "/laboratory/departments", d),
        () => find("/laboratory/departments", d.code),
      )
    ).id;
  }
  const specimenTypes: Record<string, string> = {};
  for (const s of [
    { code: "serum", name: "Serum", container: "Red-top tube" },
    { code: "wb-edta", name: "Whole blood (EDTA)", container: "Lavender-top tube" },
  ]) {
    specimenTypes[s.code] = (
      await ensure(
        () => call<{ id: string }>(admin, "POST", "/laboratory/specimen-types", s),
        () => find("/laboratory/specimen-types", s.code),
      )
    ).id;
  }
  const tests: Record<string, string> = {};
  const existing = await call<Array<{ id: string; code: string }>>(admin, "GET", "/laboratory/tests");
  for (const t of [
    {
      code: "fbs",
      name: "Fasting blood sugar",
      departmentId: departments.chem,
      specimenTypeId: specimenTypes.serum,
      unit: "mg/dL",
      decimalPlaces: 0,
      requiresFasting: true,
      turnaroundMinutes: 120,
      loincCode: "1558-6",
      range: { low: 70, high: 99, criticalLow: 40, criticalHigh: 400 },
    },
    {
      code: "hba1c",
      name: "HbA1c",
      departmentId: departments.chem,
      specimenTypeId: specimenTypes["wb-edta"],
      unit: "%",
      decimalPlaces: 1,
      turnaroundMinutes: 240,
      loincCode: "4548-4",
      range: { high: 5.6 },
    },
    {
      code: "crea",
      name: "Creatinine",
      departmentId: departments.chem,
      specimenTypeId: specimenTypes.serum,
      unit: "mg/dL",
      decimalPlaces: 2,
      turnaroundMinutes: 120,
      loincCode: "2160-0",
      range: { low: 0.6, high: 1.2, criticalHigh: 7 },
    },
    {
      code: "potassium",
      name: "Potassium",
      departmentId: departments.chem,
      specimenTypeId: specimenTypes.serum,
      unit: "mmol/L",
      decimalPlaces: 1,
      turnaroundMinutes: 120,
      loincCode: "2823-3",
      range: { low: 3.5, high: 5.1, criticalLow: 2.5, criticalHigh: 6.5 },
    },
    {
      code: "hgb",
      name: "Hemoglobin",
      departmentId: departments.hema,
      specimenTypeId: specimenTypes["wb-edta"],
      unit: "g/dL",
      decimalPlaces: 1,
      turnaroundMinutes: 60,
      loincCode: "718-7",
      range: { low: 12, high: 16, criticalLow: 7 },
    },
  ]) {
    const { range, ...test } = t;
    const found = existing.find((e) => e.code === t.code);
    if (found) {
      tests[t.code] = found.id;
      continue;
    }
    const created = await call<{ id: string }>(admin, "POST", "/laboratory/tests", { ...test, resultType: "numeric" });
    tests[t.code] = created.id;
    await call(admin, "POST", `/laboratory/tests/${created.id}/reference-ranges`, range);
  }
  await quietly(() => call(admin, "POST", "/laboratory/panels", { code: "dm-monitor", name: "Diabetes monitoring", testIds: [tests.fbs, tests.hba1c] }));
  // One medical technologist on duty may verify their own entries; the pathologist approves and the result is released on approval.
  await quietly(() =>
    call(admin, "PUT", "/laboratory/policy", {
      allowSelfVerification: true,
      allowSelfApproval: false,
      releaseOnApproval: true,
      reason: "Demo clinic: one medical technologist per shift",
    }),
  );
  log("Laboratory: departments, specimen types, 5 tests with reference ranges, a panel, the facility policy");
  return { tests, specimenTypes };
}

// ---- billing ------------------------------------------------------------------------------------------------------

async function seedBilling(admin: Session): Promise<void> {
  const effectiveFrom = shiftDays(localDate(), -30);
  for (const s of [
    { code: "consult", name: "Consultation fee", category: "consultation", sourceKind: "visit_type", sourceCode: "consult", unitPrice: 50_000 },
    { code: "follow-up", name: "Follow-up consultation", category: "consultation", sourceKind: "visit_type", sourceCode: "follow-up", unitPrice: 30_000 },
    { code: "teleconsult", name: "Online consultation", category: "consultation", sourceKind: "visit_type", sourceCode: "teleconsult", unitPrice: 40_000 },
    { code: "fbs", name: "Fasting blood sugar", category: "laboratory", sourceKind: "lab_test", sourceCode: "fbs", unitPrice: 15_000 },
    { code: "hba1c", name: "HbA1c", category: "laboratory", sourceKind: "lab_test", sourceCode: "hba1c", unitPrice: 85_000 },
    { code: "crea", name: "Creatinine", category: "laboratory", sourceKind: "lab_test", sourceCode: "crea", unitPrice: 20_000 },
    { code: "potassium", name: "Potassium", category: "laboratory", sourceKind: "lab_test", sourceCode: "potassium", unitPrice: 25_000 },
    { code: "hgb", name: "Hemoglobin", category: "laboratory", sourceKind: "lab_test", sourceCode: "hgb", unitPrice: 12_000 },
    { code: "med-cert", name: "Medical certificate", category: "other", unitPrice: 15_000 },
  ]) {
    await quietly(() => call(admin, "POST", "/billing/services", { ...s, effectiveFrom }));
  }
  await quietly(() => call(admin, "POST", "/billing/payers", { code: "philhealth", name: "PhilHealth", payerType: "philhealth" }));
  await quietly(() => call(admin, "POST", "/billing/payers", { code: "maxicare", name: "Maxicare", payerType: "hmo" }));
  await quietly(() =>
    call(admin, "POST", "/billing/discount-rules", {
      code: "senior",
      name: "Senior citizen",
      kind: "senior_citizen",
      rateBp: 2_000,
      effectiveFrom,
      requiresEvidence: true,
    }),
  );
  log("Billing: services and prices, payers, a senior-citizen discount rule");
}

// ---- patients -----------------------------------------------------------------------------------------------------

interface Patient {
  id: string;
  patientNumber: string;
  displayName: string;
}

const PATIENTS = [
  {
    familyName: "Santos",
    givenName: "Maria",
    middleName: "Reyes",
    sex: "female",
    birthDate: "1978-05-14",
    mobile: "0917 555 0101",
    barangay: "Poblacion",
    city: "Quezon City",
    pin: "19-025678901-5",
    portal: true,
  },
  {
    familyName: "Dela Cruz",
    givenName: "Juan",
    middleName: "Garcia",
    sex: "male",
    birthDate: "1965-11-02",
    mobile: "0918 555 0102",
    barangay: "San Isidro",
    city: "Antipolo",
    pin: "12-345678901-2",
  },
  {
    familyName: "Reyes",
    givenName: "Ana",
    middleName: "Lopez",
    sex: "female",
    birthDate: "1992-02-20",
    mobile: "0920 555 0103",
    barangay: "Bagong Silang",
    city: "Caloocan",
  },
  {
    familyName: "Garcia",
    givenName: "Jose",
    middleName: "Tan",
    sex: "male",
    birthDate: "1950-08-09",
    mobile: "0915 555 0104",
    barangay: "Poblacion",
    city: "Marikina",
    pin: "03-456789012-3",
    senior: true,
  },
  {
    familyName: "Mendoza",
    givenName: "Liza",
    middleName: "Cruz",
    sex: "female",
    birthDate: "1988-12-30",
    mobile: "0916 555 0105",
    barangay: "Sta. Lucia",
    city: "Pasig",
  },
  {
    familyName: "Bautista",
    givenName: "Ramon",
    middleName: "Flores",
    sex: "male",
    birthDate: "1983-03-17",
    mobile: "0919 555 0106",
    barangay: "Ugong",
    city: "Valenzuela",
  },
  {
    familyName: "Villanueva",
    givenName: "Grace",
    middleName: "Ramos",
    sex: "female",
    birthDate: "2001-07-04",
    mobile: "0921 555 0107",
    barangay: "Talon",
    city: "Las Piñas",
  },
  {
    familyName: "Navarro",
    givenName: "Paolo",
    middleName: "Santos",
    sex: "male",
    birthDate: "2015-09-23",
    mobile: "0922 555 0108",
    barangay: "Poblacion",
    city: "San Mateo",
  },
  {
    familyName: "Lim",
    givenName: "Teresa",
    middleName: "Ong",
    sex: "female",
    birthDate: "1972-01-11",
    mobile: "0923 555 0109",
    barangay: "Malanday",
    city: "Marikina",
    pin: "08-567890123-4",
  },
  {
    familyName: "Dizon",
    givenName: "Carlo",
    middleName: "Perez",
    sex: "male",
    birthDate: "1996-06-06",
    mobile: "0924 555 0110",
    barangay: "Pinagbuhatan",
    city: "Pasig",
  },
] as const;

async function seedPatients(desk: Session, admin: Session, nurse: Session): Promise<Record<string, Patient>> {
  const patients: Record<string, Patient> = {};
  for (const p of PATIENTS) {
    const body = {
      familyName: p.familyName,
      givenName: p.givenName,
      middleName: p.middleName,
      sex: p.sex,
      birthDate: p.birthDate,
      contacts: [{ system: "mobile", value: p.mobile }],
      addresses: [{ barangay: p.barangay, cityMunicipality: p.city, province: "Metro Manila", postalCode: "1800" }],
      identifiers: "pin" in p && p.pin ? [{ type: "philhealth_pin", value: p.pin }] : [],
    };
    const patient = await ensure(
      () => call<Patient>(desk, "POST", "/patients", body),
      async () => {
        const result = await call<{ items?: Patient[] } | Patient[]>(desk, "GET", `/patients?q=${encodeURIComponent(`${p.familyName} ${p.givenName}`)}`);
        const items = Array.isArray(result) ? result : (result.items ?? []);
        return items[0];
      },
    );
    patients[p.familyName.toLowerCase().replace(/\s/g, "")] = patient;
    for (const consentType of ["data_processing", "treatment_general"]) {
      await quietly(() => call(admin, "POST", `/patients/${patient.id}/consents`, { consentType, decision: "granted", capturedVia: "paper" }));
    }
  }
  // Allergies: one documented drug allergy, two reviews of "no known allergies".
  await quietly(() =>
    call(nurse, "POST", `/patients/${patients.delacruz!.id}/allergies`, {
      category: "medication",
      substance: "Penicillin",
      reaction: "Hives",
      criticality: "high",
      verification: "confirmed",
    }),
  );
  await quietly(() => call(nurse, "POST", `/patients/${patients.santos!.id}/allergy-reviews`, { noKnownAllergies: true }));
  await quietly(() => call(nurse, "POST", `/patients/${patients.reyes!.id}/allergy-reviews`, { noKnownAllergies: true }));
  log(`Patients: ${PATIENTS.length} registered with consents; allergies recorded`);
  return patients;
}

async function seedPortal(admin: Session, organizationCode: string, patient: Patient, birthDate: string): Promise<string> {
  const email = `maria.santos@${DOMAIN}`;
  await quietly(() => call(admin, "POST", `/patients/${patient.id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }));
  try {
    await call(null, "POST", "/portal/auth/login", { organizationCode, email, password: PASSWORD });
    return email; // already activated
  } catch {
    // not yet: invite and activate
  }
  const invitation = await call<{ activationCode: string }>(admin, "POST", `/patients/${patient.id}/portal-account/invitations`);
  await call(null, "POST", "/portal/auth/activate", {
    organizationCode,
    patientNumber: patient.patientNumber,
    birthDate,
    activationCode: invitation.activationCode,
    email,
    password: PASSWORD,
  });
  log(`MyHealth: ${email} activated (password ${PASSWORD})`);
  return email;
}

// ---- today ----------------------------------------------------------------------------------------------------------

interface Today {
  encounterId?: string;
  invoiceNumber?: string;
}

async function seedToday(
  sessions: { desk: Session; nurse: Session; doctor: Session; reyes: Session; medtech: Session; pathologist: Session; cashier: Session },
  facility: Facility,
  config: Config,
  lab: LabCatalog,
  patients: Record<string, Patient>,
): Promise<Today> {
  const today = localDate();
  const { desk, nurse, doctor, reyes, medtech, pathologist, cashier } = sessions;
  const out: Today = {};

  // Appointments today with Dr. Santos: the next open slots, or (evenings, weekends) times outside the schedule.
  const availability = await call<{ slots: Array<{ startsAt: string }> }>(
    desk,
    "GET",
    `/appointments/availability?practitionerId=${config.practitioners["dr.santos"]}&facilityId=${facility.id}&visitTypeId=${config.visitTypes.consult}&date=${today}`,
  );
  const inAnHour = new Date(Date.now() + 3_600_000);
  inAnHour.setMinutes(0, 0, 0);
  const starts =
    availability.slots.length >= 3
      ? availability.slots.slice(0, 3).map((s) => s.startsAt)
      : [0, 20, 40].map((m) => new Date(inAnHour.getTime() + m * 60_000).toISOString());
  const booked: string[] = [];
  for (const [i, key] of ["santos", "garcia", "mendoza"].entries()) {
    const patient = patients[key]!;
    const reason = ["Follow-up for diabetes", "Dizziness and headache", "Annual check-up"][i];
    try {
      const result = await call<Array<{ id: string }>>(
        desk,
        "POST",
        "/appointments",
        {
          patientId: patient.id,
          practitionerId: config.practitioners["dr.santos"],
          facilityId: facility.id,
          visitTypeId: config.visitTypes.consult,
          startsAt: starts[i],
          reason,
          outsideSchedule: availability.slots.length < 3,
        },
        { "idempotency-key": `demo-appointment-${today}-${key}` },
      );
      booked.push(result[0]!.id);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409)) throw error;
    }
  }
  // Tomorrow and the day after: a few more bookings so the schedule and calendar look alive.
  for (const [offset, key, practitioner] of [
    [1, "reyes", "dr.reyes"],
    [1, "bautista", "dr.santos"],
    [2, "villanueva", "dr.reyes"],
    [3, "lim", "dr.santos"],
  ] as const) {
    const date = shiftDays(today, offset);
    const slots = await call<{ slots: Array<{ startsAt: string }> }>(
      desk,
      "GET",
      `/appointments/availability?practitionerId=${config.practitioners[practitioner]}&facilityId=${facility.id}&visitTypeId=${config.visitTypes.consult}&date=${date}`,
    );
    const startsAt = slots.slots[0]?.startsAt ?? manila(date, "09:00");
    await quietly(() =>
      call(
        desk,
        "POST",
        "/appointments",
        {
          patientId: patients[key]!.id,
          practitionerId: config.practitioners[practitioner],
          facilityId: facility.id,
          visitTypeId: config.visitTypes.consult,
          startsAt,
          outsideSchedule: !slots.slots[0],
        },
        { "idempotency-key": `demo-appointment-${date}-${key}` },
      ),
    );
  }

  // The queue: a checked-in appointment that goes through the whole consultation, a walk-in triaged to the emergency
  // room, and a walk-in still waiting.
  const queue = await call<Array<{ id: string; patientId: string; status: string; version: number }>>(desk, "GET", "/queue?includeClosed=true");
  const visitOf = (patient: Patient) => queue.find((v) => v.patientId === patient.id);

  let santosVisit = visitOf(patients.santos!);
  if (!santosVisit && booked[0]) {
    santosVisit = await call(desk, "POST", `/appointments/${booked[0]}/check-in`, { chiefComplaint: "Follow-up for diabetes; fatigue" });
  }
  if (santosVisit && santosVisit.status === "waiting") {
    await call(nurse, "POST", `/queue/visits/${santosVisit.id}/triage`, {
      chiefComplaint: "Follow-up for diabetes; fatigue for two weeks",
      priority: "routine",
      riskFlags: [],
      vitals: { systolicMmhg: 138, diastolicMmhg: 86, heartRateBpm: 84, temperatureC: 36.7, weightKg: 71, heightCm: 158, bloodGlucoseMgDl: 186 },
      servicePointId: config.servicePoints.opd,
    });
  }

  if (!visitOf(patients.delacruz!)) {
    const walkIn = await call<{ id: string }>(desk, "POST", "/queue/walk-ins", {
      patientId: patients.delacruz!.id,
      visitTypeId: config.visitTypes.consult,
      priority: "urgent",
      chiefComplaint: "Chest pain since this morning",
    });
    await call(nurse, "POST", `/queue/visits/${walkIn.id}/triage`, {
      chiefComplaint: "Chest pain radiating to the left arm",
      priority: "emergency",
      riskFlags: ["cardiac"],
      vitals: { systolicMmhg: 162, diastolicMmhg: 98, heartRateBpm: 108, temperatureC: 36.9, spo2Percent: 95 },
      servicePointId: config.servicePoints.er,
    });
  }
  if (!visitOf(patients.dizon!)) {
    await call(desk, "POST", "/queue/walk-ins", {
      patientId: patients.dizon!.id,
      visitTypeId: config.visitTypes.consult,
      chiefComplaint: "Cough and colds, 3 days",
    });
  }

  // The consultation: Dr. Santos sees Maria Santos — note, diagnosis, prescription, laboratory order — and signs.
  // Each step checks what is already there, so an interrupted run resumes.
  if (santosVisit) {
    type Encounter = { id: string; status: string; visitId: string | null };
    const encounters = await call<{ items?: Encounter[] } | Encounter[]>(doctor, "GET", `/encounters?patientId=${patients.santos!.id}`);
    const list = Array.isArray(encounters) ? encounters : (encounters.items ?? []);
    let encounter = list.find((e) => e.visitId === santosVisit!.id);
    if (!encounter) {
      encounter = await call<Encounter>(doctor, "POST", "/encounters", { visitId: santosVisit.id });
      await call(doctor, "PUT", `/encounters/${encounter.id}/note`, {
        subjective: "Two weeks of fatigue and thirst. Takes metformin irregularly. No chest pain, no visual complaints.",
        objective: "BP 138/86, HR 84, afebrile. BMI 28.4. CBG 186 mg/dL. Feet: no ulcers, pulses intact.",
        assessment: "Type 2 diabetes mellitus, suboptimally controlled. Overweight.",
        plan: "Resume metformin 500 mg twice daily with meals; FBS and HbA1c; diet and activity counselling; follow-up in 4 weeks.",
        basedOnRevision: 0,
      });
      await call(doctor, "POST", `/encounters/${encounter.id}/diagnoses`, {
        codeSystemKey: "icd10",
        code: "E11.9",
        display: "Type 2 diabetes mellitus without complications",
        rank: "primary",
        certainty: "confirmed",
        isChronic: true,
      });
      await call(doctor, "POST", "/prescriptions", {
        encounterId: encounter.id,
        items: [
          {
            genericName: "Metformin",
            strength: "500 mg",
            dosageForm: "tablet",
            doseAmount: 1,
            doseUnit: "tablet",
            route: "oral",
            frequency: "twice_daily",
            durationValue: 30,
            durationUnit: "days",
            quantity: 60,
            quantityUnit: "tablet",
            refills: 2,
            instructions: "Take with meals",
          },
        ],
      });
    }
    // The laboratory: order once; collect, receive, enter, verify and approve whatever is still to do (released on
    // approval by the facility policy).
    type Order = { id: string; encounterId: string | null };
    const orders = await call<{ items?: Order[] } | Order[]>(doctor, "GET", `/laboratory/orders?patientId=${patients.santos!.id}`);
    const orderList = Array.isArray(orders) ? orders : (orders.items ?? []);
    let order = orderList.find((o) => o.encounterId === encounter!.id);
    if (!order) {
      order = await call<Order>(doctor, "POST", "/laboratory/orders", {
        patientId: patients.santos!.id,
        encounterId: encounter.id,
        testIds: [lab.tests.fbs, lab.tests.hba1c],
        clinicalIndication: "Diabetes monitoring",
      });
    }
    const VALUES: Record<string, { value: number; specimen: string }> = { fbs: { value: 142, specimen: "serum" }, hba1c: { value: 7.9, specimen: "wb-edta" } };
    type Item = { id: string; testId: string; status: string; specimenId: string | null; result: { id: string; status: string } | null };
    const detail = await call<{ items: Item[] }>(medtech, "GET", `/laboratory/orders/${order.id}`);
    for (const item of detail.items) {
      const test = Object.entries(lab.tests).find(([, id]) => id === item.testId)?.[0];
      const plan = test ? VALUES[test] : undefined;
      if (!plan || item.status === "cancelled") continue;
      if (item.status === "pending_collection") {
        const collected = await call<{ specimens: Array<{ id: string }> }>(medtech, "POST", `/laboratory/orders/${order.id}/specimens`, {
          specimenTypeId: lab.specimenTypes[plan.specimen],
          itemIds: [item.id],
        });
        for (const specimen of collected.specimens) await quietly(() => call(medtech, "POST", `/laboratory/specimens/${specimen.id}/receive`));
      } else if (item.status === "collected" && item.specimenId) {
        await quietly(() => call(medtech, "POST", `/laboratory/specimens/${item.specimenId}/receive`));
      }
      let result = item.result;
      if (!result)
        result = await call<{ id: string; status: string }>(medtech, "POST", `/laboratory/order-items/${item.id}/results`, { valueNumeric: plan.value });
      if (result.status === "entered") result = await call<{ id: string; status: string }>(medtech, "POST", `/laboratory/results/${result.id}/verify`);
      if (result.status === "verified") await call(pathologist, "POST", `/laboratory/results/${result.id}/approve`);
    }
    if (encounter.status === "in_progress") {
      const current = await call<{ version: number }>(doctor, "GET", `/encounters/${encounter.id}`);
      await call(doctor, "POST", `/encounters/${encounter.id}/sign`, { version: current.version });
    }
    // A follow-up in four weeks.
    const followUpDate = shiftDays(today, 28);
    const followUpSlots = await call<{ slots: Array<{ startsAt: string }> }>(
      desk,
      "GET",
      `/appointments/availability?practitionerId=${config.practitioners["dr.santos"]}&facilityId=${facility.id}&visitTypeId=${config.visitTypes["follow-up"]}&date=${followUpDate}`,
    );
    await quietly(() =>
      call(
        desk,
        "POST",
        "/appointments",
        {
          patientId: patients.santos!.id,
          practitionerId: config.practitioners["dr.santos"],
          facilityId: facility.id,
          visitTypeId: config.visitTypes["follow-up"],
          startsAt: followUpSlots.slots[0]?.startsAt ?? manila(followUpDate, "09:00"),
          outsideSchedule: !followUpSlots.slots[0],
          bookingChannel: "follow_up",
          reason: "Review FBS and HbA1c",
        },
        { "idempotency-key": `demo-follow-up-${followUpDate}` },
      ),
    );
    out.encounterId = encounter.id;

    // Billing: the charges captured from the consultation and the laboratory order, invoiced and paid in cash.
    const invoices = await call<
      { items?: Array<{ id: string; status: string; invoiceNumber: string | null }> } | Array<{ id: string; status: string; invoiceNumber: string | null }>
    >(cashier, "GET", `/billing/invoices?patientId=${patients.santos!.id}`);
    const invoiceList = Array.isArray(invoices) ? invoices : (invoices.items ?? []);
    if (!invoiceList.some((i) => i.status === "issued" || i.status === "paid")) {
      // Charges arrive through the outbox; give the relay a moment.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      try {
        const draft = await call<{ id: string; version: number }>(cashier, "POST", "/billing/invoices", { patientId: patients.santos!.id });
        const issued = await call<{ id: string; version: number; invoiceNumber: string; total: number; balance: number }>(
          cashier,
          "POST",
          `/billing/invoices/${draft.id}/issue`,
          {
            version: draft.version,
          },
        );
        await call(cashier, "POST", `/billing/invoices/${issued.id}/payments`, {
          amount: issued.balance ?? issued.total,
          method: "cash",
          idempotencyKey: `demo-pay-${issued.id}`,
        });
        out.invoiceNumber = issued.invoiceNumber;
      } catch (error) {
        log(`Billing step skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      out.invoiceNumber = invoiceList.find((i) => i.invoiceNumber)?.invoiceNumber ?? undefined;
    }
  }
  // The emergency-room patient: the second doctor has started the consultation and ordered tests, which wait on the
  // laboratory worklist; the consultation stays open for the tour to finish.
  const erVisit = (await call<Array<{ id: string; patientId: string; status: string }>>(desk, "GET", "/queue")).find(
    (v) => v.patientId === patients.delacruz!.id && v.status === "awaiting_consultation",
  );
  if (erVisit) {
    type Encounter = { id: string; status: string; visitId: string | null };
    const existing = await call<{ items?: Encounter[] } | Encounter[]>(reyes, "GET", `/encounters?patientId=${patients.delacruz!.id}`);
    const list = Array.isArray(existing) ? existing : (existing.items ?? []);
    if (!list.some((e) => e.visitId === erVisit.id)) {
      const encounter = await call<Encounter>(reyes, "POST", "/encounters", { visitId: erVisit.id });
      await call(reyes, "PUT", `/encounters/${encounter.id}/note`, {
        subjective: "Chest pain since 06:00, pressing, radiating to the left arm; nausea. Smoker, 20 pack-years.",
        objective: "BP 162/98, HR 108, SpO2 95%. Diaphoretic. ECG pending.",
        assessment: "Acute chest pain, rule out acute coronary syndrome.",
        plan: "Potassium and hemoglobin now; ECG; aspirin given; refer for emergency care if the ECG is ischemic.",
        basedOnRevision: 0,
      });
      await call(reyes, "POST", "/laboratory/orders", {
        patientId: patients.delacruz!.id,
        encounterId: encounter.id,
        testIds: [lab.tests.potassium, lab.tests.hgb],
        priority: "stat",
        clinicalIndication: "Acute chest pain",
      });
    }
  }
  log(
    "Today: appointments, the queue (one at the emergency room with a STAT order on the worklist), a signed consultation with released results, an invoice paid",
  );
  return out;
}

// ---- main ---------------------------------------------------------------------------------------------------------

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (the administrator from pnpm db:seed)");
  log(`Demo data → ${API}`);
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const me = await call<{ organization: { id: string; code: string; name: string } }>(admin, "GET", "/auth/me");
  const facilities = await call<Facility[]>(admin, "GET", "/auth/me/facilities");
  const facility = facilities[0];
  if (!facility) throw new Error("The organization has no facility; run pnpm db:seed first");
  admin.facilityId = facility.id;
  log(`Organization ${me.organization.name} (${me.organization.code}), facility ${facility.name}`);

  const staff = await seedStaff(admin);
  const config = await seedClinic(admin, facility, staff);
  const lab = await seedLaboratory(admin);
  await seedBilling(admin);

  const session = async (key: StaffKey): Promise<Session> => ({ ...(await login(emailOf(key), PASSWORD, me.organization.id)), facilityId: facility.id });
  const sessions: Session[] = [];
  for (const key of ["reception", "nurse", "dr.santos", "dr.reyes", "medtech", "pathologist", "cashier"] as const) sessions.push(await session(key));
  const [desk, nurse, doctor, reyes, medtech, pathologist, cashier] = sessions as [Session, Session, Session, Session, Session, Session, Session];
  const patients = await seedPatients(desk, admin, nurse);
  const portalEmail = await seedPortal(admin, me.organization.code, patients.santos!, PATIENTS[0].birthDate);
  const today = await seedToday({ desk, nurse, doctor, reyes, medtech, pathologist, cashier }, facility, config, lab, patients);

  log("");
  log("Demo accounts (staff app, organization " + me.organization.code + "):");
  for (const member of STAFF) log(`  ${member.name.padEnd(26)} ${emailOf(member.key).padEnd(36)} ${member.roles.join(", ")}`);
  log(`  Administrator              ${ADMIN_EMAIL}`);
  log(`MyHealth: ${portalEmail} (patient ${patients.santos!.patientNumber})`);
  log(`Password for every demo account: ${PASSWORD}`);
  if (today.encounterId) log(`Signed consultation: /clinic/encounters/${today.encounterId}`);
  if (today.invoiceNumber) log(`Invoice: ${today.invoiceNumber}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
