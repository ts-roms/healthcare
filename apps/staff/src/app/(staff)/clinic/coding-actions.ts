"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { CodingSystem } from "@/lib/api/types";

const uuid = z.uuid();
const key = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Use 2–49 lower-case letters, digits or hyphens.");
const name = z.string().trim().min(1, "Name the coding system.").max(120);
const version = z.string().trim().max(40);

const refresh = () => {
  revalidatePath("/clinic/coding-systems");
};

/** Registers a diagnosis coding system (its key is how diagnoses name it and never changes). */
export async function createCodingSystem(input: { key: string; name: string; version: string }): Promise<ActionResult<CodingSystem>> {
  const parsed = z.object({ key, name, version }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  const result = await actionResult(() =>
    api<CodingSystem>("/clinic/coding-systems", { method: "POST", body: { ...parsed.data, version: parsed.data.version || undefined } }),
  );
  if (result.ok) refresh();
  return result;
}

/** Renames a system or changes its edition text. */
export async function updateCodingSystem(id: string, input: { name: string; version: string }): Promise<ActionResult<CodingSystem>> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "Unknown coding system." };
  const parsed = z.object({ name, version }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  const result = await actionResult(() =>
    api<CodingSystem>(`/clinic/coding-systems/${id}`, { method: "PATCH", body: { name: parsed.data.name, version: parsed.data.version || null } }),
  );
  if (result.ok) refresh();
  return result;
}

/** Deactivating stops new diagnoses against the system; recorded diagnoses keep their code and system. */
export async function setCodingSystemStatus(id: string, status: "active" | "inactive"): Promise<ActionResult<CodingSystem>> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "Unknown coding system." };
  const result = await actionResult(() => api<CodingSystem>(`/clinic/coding-systems/${id}`, { method: "PATCH", body: { status } }));
  if (result.ok) refresh();
  return result;
}
