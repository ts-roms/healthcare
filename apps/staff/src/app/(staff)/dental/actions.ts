"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import { uploadPatientDocument } from "@/lib/api/documents";
import type {
  DentalExamination,
  DentalPerioChartDetail,
  DentalImage,
  DentalProcedure,
  DentalProcedureType,
  DentalToothHistoryEntry,
  DentalTreatmentPlan,
} from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call (dentist, encounter, teeth).

const id = z.uuid();
const tooth = z.string().regex(/^([1-4][1-8]|[5-8][1-5])$/, "Choose a tooth.");
const surfaces = z.array(z.enum(["M", "D", "O", "I", "B", "L"])).max(6);
const key = z.string().min(8).max(100);
const reason = z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500);
const version = z.number().int().positive();
const finding = z.object({
  condition: z.enum(["caries", "restoration", "sealant", "fracture", "crown", "root_canal", "missing", "implant", "pontic", "impacted", "unerupted", "watch"]),
  surfaces,
});

async function run<T>(
  schema: z.ZodType,
  input: unknown,
  path: string,
  options: { method?: "POST" | "PUT" | "PATCH"; idempotencyKey?: string; revalidate: string[] },
): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const result = await actionResult(() => api<T>(path, { method: options.method ?? "POST", body: parsed.data, idempotencyKey: options.idempotencyKey }));
  if (result.ok) for (const path of options.revalidate) revalidatePath(path);
  return result;
}

const record = (patientId: string) => [`/dental/patients/${patientId}`, "/dental"];

// ---- visits and examinations ------------------------------------------------------------------------

/** Starts a dental visit (a clinic encounter with the signed-in dentist) for a patient without a queue visit. */
export async function startDentalVisit(patientId: string, chiefComplaint: string): Promise<ActionResult<{ id: string }>> {
  if (!id.safeParse(patientId).success) return { ok: false, message: "Unknown patient." };
  return run(
    z.object({ patientId: id, chiefComplaint: z.string().trim().max(500).optional() }),
    { patientId, chiefComplaint: chiefComplaint || undefined },
    "/encounters",
    {
      revalidate: record(patientId),
    },
  );
}

const examinationSchema = z.object({
  encounterId: id,
  oralHygiene: z.enum(["good", "fair", "poor"]).optional(),
  notes: z.string().trim().max(4000).optional(),
  teeth: z.array(z.object({ tooth, findings: z.array(finding).max(12), note: z.string().trim().max(500).optional() })).max(52),
});
export async function recordExamination(
  patientId: string,
  input: z.input<typeof examinationSchema>,
  idempotencyKey: string,
): Promise<ActionResult<DentalExamination>> {
  if (!id.safeParse(patientId).success || !key.safeParse(idempotencyKey).success) return { ok: false, message: "Unknown patient." };
  return run(examinationSchema, input, `/dental/patients/${patientId}/examinations`, { idempotencyKey, revalidate: record(patientId) });
}

export async function markExaminationEnteredInError(patientId: string, examinationId: string, why: string) {
  if (!id.safeParse(examinationId).success) return { ok: false as const, message: "Unknown examination." };
  return run(z.object({ reason }), { reason: why }, `/dental/examinations/${examinationId}/entered-in-error`, { revalidate: record(patientId) });
}

/** Every charted state of one tooth (loaded on request; the API audits the view). */
export async function loadToothHistory(patientId: string, toothCode: string): Promise<ActionResult<DentalToothHistoryEntry[]>> {
  if (!id.safeParse(patientId).success || !tooth.safeParse(toothCode).success) return { ok: false, message: "Unknown tooth." };
  return actionResult(() => api<DentalToothHistoryEntry[]>(`/dental/patients/${patientId}/teeth/${toothCode}`));
}

// ---- periodontal charts -----------------------------------------------------------------------------

const mm = (min: number, max: number) => z.number().int().min(min).max(max).optional();
const perioSchema = z.object({
  encounterId: id,
  notes: z.string().trim().max(4000).optional(),
  teeth: z
    .array(
      z.object({
        tooth,
        mobility: mm(0, 3),
        furcation: mm(0, 3),
        sites: z
          .array(
            z.object({
              site: z.enum(["MB", "B", "DB", "ML", "L", "DL"]),
              probingDepth: mm(0, 20),
              gingivalMargin: mm(-10, 20),
              bleeding: z.boolean(),
              suppuration: z.boolean(),
              plaque: z.boolean(),
            }),
          )
          .max(6),
      }),
    )
    .min(1, "Enter the measurements of at least one tooth.")
    .max(52),
});
export async function recordPerioChart(
  patientId: string,
  input: z.input<typeof perioSchema>,
  idempotencyKey: string,
): Promise<ActionResult<DentalPerioChartDetail>> {
  if (!id.safeParse(patientId).success || !key.safeParse(idempotencyKey).success) return { ok: false, message: "Unknown patient." };
  return run(perioSchema, input, `/dental/patients/${patientId}/perio-charts`, { idempotencyKey, revalidate: record(patientId) });
}

/** One chart with its measurements and the changes since the previous chart (the API audits the view). */
export async function loadPerioChart(chartId: string): Promise<ActionResult<DentalPerioChartDetail>> {
  if (!id.safeParse(chartId).success) return { ok: false, message: "Unknown chart." };
  return actionResult(() => api<DentalPerioChartDetail>(`/dental/perio-charts/${chartId}`));
}

export async function markPerioChartEnteredInError(patientId: string, chartId: string, why: string) {
  if (!id.safeParse(chartId).success) return { ok: false as const, message: "Unknown chart." };
  return run(z.object({ reason }), { reason: why }, `/dental/perio-charts/${chartId}/entered-in-error`, { revalidate: record(patientId) });
}

// ---- treatment plans --------------------------------------------------------------------------------

const planItem = z.object({
  phase: z.number().int().min(1).max(9),
  procedureTypeId: id,
  tooth: tooth.optional(),
  surfaces,
  note: z.string().trim().max(500).optional(),
});

const planSchema = z.object({
  patientId: id,
  title: z.string().trim().min(1, "Give the plan a title.").max(160),
  notes: z.string().trim().max(2000).optional(),
  items: z.array(planItem).min(1, "Add at least one item.").max(60),
});
export async function createTreatmentPlan(input: z.input<typeof planSchema>, idempotencyKey: string): Promise<ActionResult<DentalTreatmentPlan>> {
  return run(planSchema, input, "/dental/treatment-plans", { idempotencyKey, revalidate: record(input.patientId) });
}

export async function addPlanItem(patientId: string, planId: string, input: z.input<typeof planItem> & { version: number }) {
  if (!id.safeParse(planId).success) return { ok: false as const, message: "Unknown plan." };
  return run<DentalTreatmentPlan>(planItem.extend({ version }), input, `/dental/treatment-plans/${planId}/items`, { revalidate: record(patientId) });
}

const decisionSchema = z.object({
  acceptedItemIds: z.array(id).max(60),
  note: z.string().trim().min(3, "Say how the patient decided (e.g. options and fees explained, consent form signed).").max(1000),
  version,
});
export async function decideTreatmentPlan(patientId: string, planId: string, input: z.input<typeof decisionSchema>) {
  if (!id.safeParse(planId).success) return { ok: false as const, message: "Unknown plan." };
  return run<DentalTreatmentPlan>(decisionSchema, input, `/dental/treatment-plans/${planId}/decision`, { revalidate: record(patientId) });
}

export async function cancelPlanItem(patientId: string, planId: string, itemId: string, planVersion: number) {
  if (!id.safeParse(planId).success || !id.safeParse(itemId).success) return { ok: false as const, message: "Unknown plan item." };
  return run<DentalTreatmentPlan>(z.object({ version }), { version: planVersion }, `/dental/treatment-plans/${planId}/items/${itemId}/cancel`, {
    revalidate: record(patientId),
  });
}

export async function discontinueTreatmentPlan(patientId: string, planId: string, why: string, planVersion: number) {
  if (!id.safeParse(planId).success) return { ok: false as const, message: "Unknown plan." };
  return run<DentalTreatmentPlan>(z.object({ reason, version }), { reason: why, version: planVersion }, `/dental/treatment-plans/${planId}/discontinue`, {
    revalidate: record(patientId),
  });
}

// ---- procedures -------------------------------------------------------------------------------------

const procedureSchema = z.object({
  encounterId: id,
  procedureTypeId: z.uuid("Choose the procedure."),
  tooth: tooth.optional(),
  surfaces,
  notes: z.string().trim().max(2000).optional(),
  planItemId: id.optional(),
});
export async function recordProcedure(
  patientId: string,
  input: z.input<typeof procedureSchema>,
  idempotencyKey: string,
): Promise<ActionResult<DentalProcedure>> {
  if (!id.safeParse(patientId).success || !key.safeParse(idempotencyKey).success) return { ok: false, message: "Unknown patient." };
  return run(procedureSchema, input, `/dental/patients/${patientId}/procedures`, { idempotencyKey, revalidate: record(patientId) });
}

export async function markProcedureEnteredInError(patientId: string, procedureId: string, why: string) {
  if (!id.safeParse(procedureId).success) return { ok: false as const, message: "Unknown procedure." };
  return run(z.object({ reason }), { reason: why }, `/dental/procedures/${procedureId}/entered-in-error`, { revalidate: record(patientId) });
}

// ---- imaging ----------------------------------------------------------------------------------------

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/tiff", "application/dicom"]);
const imageSchema = z.object({
  kind: z.enum(["periapical", "bitewing", "panoramic", "cephalometric", "occlusal", "cbct", "intraoral_photo", "extraoral_photo", "other"]),
  teeth: z.array(tooth).max(52),
  takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it was taken."),
  encounterId: id.optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type AddImageResult = ActionResult<DentalImage> & { documentId?: string };

/**
 * Uploads a radiograph or photo as a private imaging document of the patient, then adds it to the dental record. If
 * the file was stored but not added, the document id comes back so a retry does not upload it again.
 */
export async function addDentalImage(patientId: string, data: FormData): Promise<AddImageResult> {
  if (!id.safeParse(patientId).success) return { ok: false, message: "Unknown patient." };
  const teeth = String(data.get("teeth") ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);
  const parsed = imageSchema.safeParse({
    kind: data.get("kind"),
    teeth,
    takenOn: data.get("takenOn"),
    encounterId: String(data.get("encounterId") ?? "") || undefined,
    notes: String(data.get("notes") ?? "") || undefined,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  let documentId = String(data.get("documentId") ?? "") || undefined;
  if (documentId && !id.safeParse(documentId).success) documentId = undefined;
  if (!documentId) {
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose the image file." };
    if (!IMAGE_TYPES.has(file.type)) return { ok: false, message: "Use a JPEG, PNG, HEIC, TIFF or DICOM file." };
    // The staff server receives the file in the server action (limit 12 MB in next.config.ts).
    if (file.size > 10 * 1024 * 1024) return { ok: false, message: "The file is larger than 10 MB." };
    const uploaded = await actionResult(() =>
      uploadPatientDocument({
        patientId,
        category: "imaging",
        title: `Dental ${parsed.data.kind.replace("_", " ")} ${parsed.data.takenOn}`,
        file,
        idempotencyKey: String(data.get("idempotencyKey") ?? crypto.randomUUID()),
      }),
    );
    if (!uploaded.ok) return { ok: false, message: `The file was not uploaded: ${uploaded.message}` };
    documentId = uploaded.data;
  }
  const result = await actionResult(() => api<DentalImage>(`/dental/patients/${patientId}/images`, { method: "POST", body: { ...parsed.data, documentId } }));
  if (!result.ok) return { ...result, message: `The file was stored, but not added to the dental record: ${result.message}`, documentId };
  revalidatePath(`/dental/patients/${patientId}`);
  return result;
}

/** A short-lived link to open an image (the API audits each one). */
export async function dentalImageLink(imageId: string): Promise<ActionResult<{ url: string }>> {
  if (!id.safeParse(imageId).success) return { ok: false, message: "Unknown image." };
  return actionResult(async () => ({ url: (await api<{ url: string }>(`/dental/images/${imageId}/link`)).url }));
}

export async function markImageEnteredInError(patientId: string, imageId: string, why: string) {
  if (!id.safeParse(imageId).success) return { ok: false as const, message: "Unknown image." };
  return run(z.object({ reason }), { reason: why }, `/dental/images/${imageId}/entered-in-error`, { revalidate: record(patientId) });
}

// ---- settings ---------------------------------------------------------------------------------------

const procedureTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Code: lowercase letters, digits and dashes."),
  name: z.string().trim().min(1, "Enter the name.").max(160),
  site: z.enum(["mouth", "tooth", "surface"]),
  chartEffect: z.enum(["restoration", "sealant", "crown", "root_canal", "missing", "implant", "pontic"]).nullable(),
});
export async function createProcedureType(input: z.input<typeof procedureTypeSchema>) {
  return run<DentalProcedureType>(procedureTypeSchema, input, "/dental/procedure-types", { revalidate: ["/dental/settings"] });
}

export async function setProcedureTypeStatus(procedureTypeId: string, status: "active" | "inactive", typeVersion: number) {
  if (!id.safeParse(procedureTypeId).success) return { ok: false as const, message: "Unknown procedure." };
  return run<DentalProcedureType>(
    z.object({ status: z.enum(["active", "inactive"]), version }),
    { status, version: typeVersion },
    `/dental/procedure-types/${procedureTypeId}`,
    {
      method: "PATCH",
      revalidate: ["/dental/settings"],
    },
  );
}

export async function setNotation(facilityId: string, notation: "fdi" | "universal" | "palmer") {
  if (!id.safeParse(facilityId).success) return { ok: false as const, message: "Select your facility first." };
  return run(z.object({ notation: z.enum(["fdi", "universal", "palmer"]) }), { notation }, `/dental/facilities/${facilityId}/notation`, {
    method: "PUT",
    revalidate: ["/dental/settings", "/dental"],
  });
}
