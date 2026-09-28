import { request, test as setup } from "@playwright/test";
import { manilaDate, saveState, staffApi } from "../support/api";
import { API_URL, DOCTOR_NAME, ORGANIZATION_CODE, PATIENT_PASSWORD, STAFF, TELE_DOCTOR_NAME } from "../support/env";

/**
 * The clinic the journeys run in, configured through the API as an administrator would: visit types (one bookable
 * online as a teleconsultation), the doctor's weekly schedule, diagnosis coding, the laboratory catalog, and a patient
 * who already uses MyHealth (journey 2). Staff users come from support/prepare-database.ts.
 */
setup("configure the clinic", async () => {
  const bootstrap = await staffApi(STAFF.admin);
  const [facility] = await bootstrap.get<Array<{ id: string }>>("/facilities");
  await bootstrap.dispose();
  const admin = await staffApi(STAFF.admin, facility!.id);

  const practitioners = await admin.get<Array<{ id: string; displayName: string }>>("/clinic/practitioners");
  const practitioner = practitioners.find((p) => p.displayName === DOCTOR_NAME)!;
  const telePractitioner = practitioners.find((p) => p.displayName === TELE_DOCTOR_NAME)!;
  const consult = await admin.post<{ id: string }>("/clinic/visit-types", {
    code: "consult",
    name: "Consultation",
    defaultDurationMinutes: 15,
    requiresTriage: false,
  });
  const online = await admin.post<{ id: string }>("/clinic/visit-types", {
    code: "online",
    name: "Online consultation",
    defaultDurationMinutes: 20,
    modality: "telemedicine",
    requiresTriage: false,
    onlineBooking: true,
  });
  // Open all day, every day, so the journeys find slots whenever they run.
  for (const p of [practitioner, telePractitioner]) {
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      await admin.post("/clinic/schedules", {
        practitionerId: p.id,
        facilityId: facility!.id,
        dayOfWeek,
        startTime: "00:00",
        endTime: "23:59",
        slotMinutes: 15,
        validFrom: manilaDate(-1),
      });
    }
  }
  await admin.post("/clinic/coding-systems", { key: "icd10", name: "ICD-10", version: "2019" });

  const chemistry = await admin.post<{ id: string }>("/laboratory/departments", { code: "chem", name: "Chemistry" });
  const serum = await admin.post<{ id: string }>("/laboratory/specimen-types", { code: "serum", name: "Serum" });
  const fbs = await admin.post<{ id: string }>("/laboratory/tests", {
    code: "fbs",
    name: "Fasting blood sugar",
    departmentId: chemistry.id,
    specimenTypeId: serum.id,
    resultType: "numeric",
    unit: "mmol/L",
    decimalPlaces: 1,
  });
  await admin.post(`/laboratory/tests/${fbs.id}/reference-ranges`, { low: 3.9, high: 5.5 });
  const hba1c = await admin.post<{ id: string }>("/laboratory/tests", {
    code: "hba1c",
    name: "HbA1c",
    departmentId: chemistry.id,
    specimenTypeId: serum.id,
    resultType: "numeric",
    unit: "%",
    decimalPlaces: 1,
  });
  await admin.post(`/laboratory/tests/${hba1c.id}/reference-ranges`, { low: 4.0, high: 5.6 });

  // A patient who already uses MyHealth and books online (journey 2).
  const email = "ana.reyes@e2e.ph";
  const patient = await admin.post<{ id: string; patientNumber: string; displayName: string }>("/patients", {
    familyName: "Reyes",
    givenName: "Ana",
    sex: "female",
    birthDate: "1988-06-21",
    contacts: [{ system: "mobile", value: "0917 555 0142" }],
  });
  await admin.post(`/patients/${patient.id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" });
  const { activationCode } = await admin.post<{ activationCode: string }>(`/patients/${patient.id}/portal-account/invitations`);
  const portal = await request.newContext();
  const activated = await portal.post(`${API_URL}/portal/auth/activate`, {
    data: {
      organizationCode: ORGANIZATION_CODE,
      patientNumber: patient.patientNumber,
      birthDate: "1988-06-21",
      activationCode,
      email,
      password: PATIENT_PASSWORD,
    },
  });
  if (!activated.ok()) throw new Error(`Portal activation failed: ${activated.status()} ${await activated.text()}`);
  await portal.dispose();
  await admin.dispose();

  saveState({
    facilityId: facility!.id,
    practitionerId: practitioner.id,
    telePractitionerId: telePractitioner.id,
    consultVisitTypeId: consult.id,
    onlineVisitTypeId: online.id,
    onlinePatient: { id: patient.id, email, displayName: patient.displayName },
  });
});
