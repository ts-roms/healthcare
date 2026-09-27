import { notFound, redirect } from "next/navigation";
import { api } from "@/lib/api/client";
import { ApiError } from "@healthcare/web-session";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import { todayIn } from "@/lib/clinic-mapping";
import type {
  CarePlan,
  CarePlanDetail,
  CodingSystem,
  Encounter,
  EncounterDetail,
  LabOrder,
  LabPanel,
  LabTest,
  Page,
  PatientDetail,
  PatientLabResult,
  PatientSummaryResponse,
  Practitioner,
  Prescription,
  TelemedicineConsultation,
} from "@/lib/api/types";
import { encounterControls } from "@/lib/encounter-mapping";
import { toBannerPatient } from "@/lib/patient-mapping";
import { EncounterWorkspace } from "./encounter-workspace";

// Never put patient names in the tab title.
export const metadata = { title: "Encounter" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load<T>(path: string, query?: Record<string, string | number>): Promise<T> {
  try {
    return await api<T>(path, { query });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}

/** Optional context: missing permission for it hides the panel instead of failing the page. */
async function optional<T>(path: string, query?: Record<string, string | number>): Promise<T | null> {
  try {
    return await api<T>(path, { query });
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
}

/** Open care plans with goals and activities (each detail view is audited by the API). */
async function openCarePlans(patientId: string): Promise<CarePlanDetail[] | null> {
  const plans = await optional<CarePlan[]>("/care-plans", { patientId });
  if (!plans) return null;
  return Promise.all(plans.slice(0, 5).map((p) => api<CarePlanDetail>(`/care-plans/${p.id}`)));
}

export default async function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, getSession()]);
  if (!can(session, "encounter.read")) redirect("/");
  if (!UUID.test(id)) notFound();
  const encounter = await load<EncounterDetail>(`/encounters/${id}`);
  const canOrderLab = can(session, "lab.order.create") && encounter.status === "in_progress";
  const online = encounter.modality === "telemedicine" && !!encounter.appointmentId && can(session, "telemedicine.read");
  const [
    patient,
    summary,
    history,
    practitioners,
    codingSystems,
    prescriptions,
    carePlans,
    facility,
    labOrders,
    labTests,
    labPanels,
    labResults,
    consultation,
  ] = await Promise.all([
    load<PatientDetail>(`/patients/${encounter.patientId}`),
    can(session, "clinical.read") ? optional<PatientSummaryResponse>(`/patients/${encounter.patientId}/summary`) : Promise.resolve(null),
    load<Page<Encounter>>("/encounters", { patientId: encounter.patientId, pageSize: 20 }),
    can(session, "appointment.read") ? optional<Practitioner[]>("/clinic/practitioners") : Promise.resolve(null),
    optional<CodingSystem[]>("/clinic/coding-systems"),
    can(session, "prescription.read") ? optional<Prescription[]>("/prescriptions", { encounterId: encounter.id }) : Promise.resolve(null),
    can(session, "care-plan.read") ? openCarePlans(encounter.patientId) : Promise.resolve(null),
    getSelectedFacility(),
    can(session, "lab.order.read") ? optional<LabOrder[]>("/laboratory/orders", { encounterId: encounter.id }) : Promise.resolve(null),
    canOrderLab ? optional<LabTest[]>("/laboratory/tests") : Promise.resolve(null),
    canOrderLab ? optional<LabPanel[]>("/laboratory/panels") : Promise.resolve(null),
    can(session, "lab.result.read") ? optional<PatientLabResult[]>(`/laboratory/patients/${encounter.patientId}/results`) : Promise.resolve(null),
    online ? optional<TelemedicineConsultation>(`/telemedicine/consultations/${encounter.appointmentId}`) : Promise.resolve(null),
  ]);
  const names = new Map((practitioners ?? []).map((p) => [p.id, p.displayName]));
  const mine = practitioners?.find((p) => p.userId === session.user.id);
  const controls = encounterControls(encounter.status, {
    permissions: session.permissions,
    // Unknown (no practitioner list) → offer signing and let the API decide.
    isResponsiblePractitioner: practitioners ? mine?.id === encounter.practitionerId : true,
  });

  return (
    <EncounterWorkspace
      // A new encounter (history navigation) starts with fresh editor state.
      key={encounter.id}
      encounter={encounter}
      banner={toBannerPatient(patient, summary?.allergies)}
      summary={summary}
      practitionerName={names.get(encounter.practitionerId) ?? null}
      history={history.items.map((e) => ({ ...e, practitionerName: names.get(e.practitionerId) ?? null }))}
      codingSystems={(codingSystems ?? []).filter((c) => c.status === "active")}
      controls={controls}
      prescriptions={prescriptions}
      prescriptionPermissions={session.permissions.filter((p) => p.startsWith("prescription."))}
      carePlans={carePlans}
      followUp={{
        patientId: encounter.patientId,
        practitionerId: encounter.practitionerId,
        returnTo: `/clinic/encounters/${encounter.id}`,
        today: todayIn(facility?.timezone ?? "Asia/Manila"),
      }}
      canManageCarePlans={can(session, "care-plan.manage")}
      canBookFollowUp={can(session, "appointment.manage")}
      canManageAllergies={can(session, "allergy.manage")}
      telemedicine={
        consultation
          ? {
              consultation,
              canConduct: can(session, "telemedicine.conduct"),
              bookInPersonHref: can(session, "appointment.manage")
                ? `/appointments/new?patientId=${encounter.patientId}&practitionerId=${encounter.practitionerId}&returnTo=${encodeURIComponent(`/clinic/encounters/${encounter.id}`)}`
                : null,
            }
          : null
      }
      lab={{
        orders: labOrders,
        tests: labTests ?? [],
        panels: labPanels ?? [],
        results: labResults,
        canOrder: canOrderLab && !!labTests,
        canCancel: can(session, "lab.order.cancel"),
      }}
    />
  );
}
