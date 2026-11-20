"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { MedicineSetting } from "@/lib/api/types";

// The API checks the values again, authorizes (clinic.configure) and audits.
const fields = z
  .object({
    name: z.string().trim().min(2, "Give the medicine's name.").max(120),
    className: z.string().trim().max(80).optional(),
    maxDailyDose: z.number().positive("The maximum must be more than 0.").nullable(),
    doseUnit: z.string().trim().max(20).optional(),
    checkRenal: z.boolean(),
    checkPregnancy: z.boolean(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => (v.maxDailyDose === null) === !v.doseUnit, { message: "Give the maximum daily dose and its unit together.", path: ["doseUnit"] })
  .refine((v) => Boolean(v.className || v.maxDailyDose || v.checkRenal || v.checkPregnancy), {
    message: "Give a class, a maximum daily dose or a check.",
    path: ["className"],
  });
const updateFields = z.object({ id: z.uuid(), status: z.enum(["active", "inactive"]), version: z.number().int().positive() });

/** Blank optional values are left out, so the API stores null. */
function body(input: z.output<typeof fields>) {
  return {
    name: input.name,
    className: input.className || null,
    maxDailyDose: input.maxDailyDose,
    doseUnit: input.maxDailyDose === null ? null : input.doseUnit || null,
    checkRenal: input.checkRenal,
    checkPregnancy: input.checkPregnancy,
    note: input.note || null,
  };
}

export async function createMedicineSetting(input: z.input<typeof fields>): Promise<ActionResult<MedicineSetting>> {
  const parsed = fields.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the medicine setting." };
  const result = await actionResult(() => api<MedicineSetting>("/prescribing/medicines", { method: "POST", body: body(parsed.data) }));
  if (result.ok) revalidatePath("/clinic/prescribing");
  return result;
}

export async function updateMedicineSetting(input: z.input<typeof fields> & z.input<typeof updateFields>): Promise<ActionResult<MedicineSetting>> {
  const parsed = fields.safeParse(input);
  const ids = updateFields.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the medicine setting." };
  if (!ids.success) return { ok: false, message: "Invalid request." };
  const result = await actionResult(() =>
    api<MedicineSetting>(`/prescribing/medicines/${ids.data.id}`, {
      method: "PUT",
      body: { ...body(parsed.data), status: ids.data.status, version: ids.data.version },
    }),
  );
  revalidatePath("/clinic/prescribing");
  return result;
}
