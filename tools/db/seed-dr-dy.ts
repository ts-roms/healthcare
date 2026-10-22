/**
 * One-off demo data: a weekly schedule for Dr. Dy and a telemedicine appointment for the patient Five Five.
 *
 * Works through the public API as the seeded administrator, so every rule, audit event and domain event applies as in
 * use. Safe to run again: Dr. Dy, the schedule and the patient are reused, and the appointment is booked once per day.
 *
 *   node --env-file=.env -r @swc-node/register tools/db/seed-dr-dy.ts
 *
 *   API_BASE_URL                              default http://localhost:3333/api/v1
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD    the administrator from `pnpm db:seed` (required)
 *
 * Demo values only: the patient's date of birth and sex are placeholders, no licence number is invented for Dr. Dy,
 * and no consent is recorded on the patient's behalf (if the clinic requires telemedicine consent, record it in the app).
 */
const API = (process.env.API_BASE_URL ?? "http://localhost:3333/api/v1").replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const ORG_CODE = process.env.SEED_ORG_CODE ?? "demo";
const TIME_ZONE = "Asia/Manila";

type Json = Record<string, unknown>;

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

interface Session {
  token: string;
  facilityId?: string;
}

async function call<T = Json>(session: Session | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
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
  const text = await response.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const error = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const details = error?.details ? ` ${JSON.stringify(error.details).slice(0, 300)}` : "";
    throw new ApiError(
      response.status,
      error?.code,
      `${method} ${path} → ${response.status} ${error?.code ?? ""} ${error?.message ?? text.slice(0, 200)}${details}`,
    );
  }
  return json as T;
}

async function login(email: string, password: string): Promise<Session> {
  try {
    return { token: (await call<{ accessToken: string }>(null, "POST", "/auth/login", { email, password })).accessToken };
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "organization_selection_required")) throw error;
    const response = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = (await response.json()) as { error?: { details?: { organizations?: Array<{ organizationId?: string; id?: string; code?: string }> } } };
    const organizations = body.error?.details?.organizations ?? [];
    const chosen = organizations.find((o) => o.code === ORG_CODE) ?? organizations[0];
    const organizationId = chosen?.organizationId ?? chosen?.id;
    if (!organizationId) throw error;
    return { token: (await call<{ accessToken: string }>(null, "POST", "/auth/login", { email, password, organizationId })).accessToken };
  }
}

const localDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
const shiftDays = (date: string, days: number) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const dayOfWeek = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const log = (line: string) => console.log(line);

interface Practitioner {
  id: string;
  displayName: string;
  status: string;
}
interface VisitType {
  id: string;
  code: string;
  name: string;
  modality: string;
  status: string;
}
interface Patient {
  id: string;
  patientNumber: string;
  displayName: string;
}

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (the administrator from pnpm db:seed)");
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const facility = (await call<Array<{ id: string; name: string }>>(admin, "GET", "/auth/me/facilities"))[0];
  if (!facility) throw new Error("The organization has no facility; run pnpm db:seed first");
  admin.facilityId = facility.id;
  log(`→ ${API}, facility ${facility.name}`);

  // The telemedicine visit type.
  const visitTypes = await call<VisitType[]>(admin, "GET", "/clinic/visit-types");
  const telemedicine =
    visitTypes.find((v) => v.modality === "telemedicine" && v.status === "active") ??
    (await call<VisitType>(admin, "POST", "/clinic/visit-types", {
      code: "teleconsult",
      name: "Online consultation",
      defaultDurationMinutes: 20,
      modality: "telemedicine",
      requiresTriage: false,
      onlineBooking: true,
    }));
  log(`Visit type: ${telemedicine.name}`);

  // Dr. Dy.
  const practitioners = await call<Practitioner[]>(admin, "GET", "/clinic/practitioners");
  const existing = practitioners.find((p) => /\bdy\b/i.test(p.displayName));
  const drDy =
    existing ??
    (await call<Practitioner>(admin, "POST", "/clinic/practitioners", { displayName: "Dr. Dy", profession: "physician", specialty: "General practice" }));
  log(`${existing ? "Found" : "Created"} practitioner: ${drDy.displayName}`);

  // Weekly schedule: Monday to Friday, mornings and afternoons, 20-minute slots (skipped when Dr. Dy already has one here).
  const schedules = await call<Array<{ practitionerId: string; facilityId: string; status: string }>>(admin, "GET", "/clinic/schedules");
  if (schedules.some((s) => s.practitionerId === drDy.id && s.facilityId === facility.id && s.status === "active")) {
    log("Schedule: Dr. Dy already has weekly hours here; left as they are");
  } else {
    const validFrom = shiftDays(localDate(), -1);
    for (const day of [1, 2, 3, 4, 5]) {
      for (const [startTime, endTime] of [
        ["08:00", "12:00"],
        ["13:00", "17:00"],
      ] as const) {
        await call(admin, "POST", "/clinic/schedules", {
          practitionerId: drDy.id,
          facilityId: facility.id,
          dayOfWeek: day,
          startTime,
          endTime,
          slotMinutes: 20,
          validFrom,
        });
      }
    }
    log("Schedule: Mon–Fri 08:00–12:00 and 13:00–17:00, 20-minute slots");
  }

  // The patient, Five Five.
  const found = await call<{ items?: Patient[] } | Patient[]>(admin, "GET", `/patients?q=${encodeURIComponent("Five Five")}`);
  const matches = Array.isArray(found) ? found : (found.items ?? []);
  const patient =
    matches.find((p) => /five/i.test(p.displayName)) ??
    (await call<Patient>(admin, "POST", "/patients", {
      familyName: "Five",
      givenName: "Five",
      sex: "unknown",
      birthDate: "1990-01-01",
      contacts: [],
      addresses: [],
      identifiers: [],
    }));
  log(`${matches.length ? "Found" : "Registered"} patient: ${patient.displayName} (${patient.patientNumber})`);

  // A telemedicine appointment: the first open slot on the next working day.
  let date = localDate();
  let slot: string | undefined;
  for (let i = 0; i < 10 && !slot; i += 1) {
    date = shiftDays(localDate(), i);
    if (dayOfWeek(date) === 0 || dayOfWeek(date) === 6) continue;
    const availability = await call<{ slots: Array<{ startsAt: string }> }>(
      admin,
      "GET",
      `/appointments/availability?practitionerId=${drDy.id}&facilityId=${facility.id}&visitTypeId=${telemedicine.id}&date=${date}`,
    );
    slot = availability.slots.find((s) => new Date(s.startsAt).getTime() > Date.now())?.startsAt;
  }
  if (!slot) throw new Error("No open telemedicine slot for Dr. Dy in the next 10 days; check the schedule.");
  const booked = await call<Array<{ id: string; startsAt: string }>>(
    admin,
    "POST",
    "/appointments",
    {
      patientId: patient.id,
      practitionerId: drDy.id,
      facilityId: facility.id,
      visitTypeId: telemedicine.id,
      startsAt: slot,
      reason: "Demo online consultation",
    },
    { "idempotency-key": `demo-dr-dy-teleconsult-${localDate()}` },
  );
  const when = new Intl.DateTimeFormat("en-PH", { timeZone: TIME_ZONE, dateStyle: "full", timeStyle: "short" }).format(new Date(booked[0]?.startsAt ?? slot));
  log(`Booked telemedicine appointment for ${patient.displayName} with ${drDy.displayName}: ${when}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
