"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { PatientQrSetting } from "@/lib/api/types";

// The API validates and authorizes (patient.qr.manage) and audits the change; shapes are checked here to fail fast.
const schema = z.object({
  enabled: z.boolean(),
  issueAtRegistration: z.boolean(),
  content: z.enum(["token", "patient_number"]),
  version: z.number().int().min(0),
});

export async function savePatientQrSetting(input: z.input<typeof schema>): Promise<ActionResult<PatientQrSetting>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the settings." };
  const result = await actionResult(() => api<PatientQrSetting>("/patient-qr/setting", { method: "PUT", body: parsed.data }));
  revalidatePath("/admin/patient-qr");
  return result;
}
