"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { ManagementReportSchedule } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates the tables, the scope and every recipient.

const scheduleSchema = z.object({
  name: z.string().trim().min(2, "Give the report a name.").max(120),
  cadence: z.enum(["weekly", "monthly"]),
  tables: z.array(z.string().min(1)).min(1, "Choose at least one table.").max(20),
  facilityId: z.uuid().nullable(),
  recipientUserIds: z.array(z.uuid()).min(1, "Choose at least one recipient.").max(50),
});

export async function saveReportSchedule(
  input: z.input<typeof scheduleSchema>,
  existing: { id: string; version: number } | null,
): Promise<ActionResult<ManagementReportSchedule>> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the schedule." };
  const result = await actionResult(() =>
    existing
      ? api<ManagementReportSchedule>(`/management/report-schedules/${existing.id}`, { method: "PUT", body: { ...parsed.data, version: existing.version } })
      : api<ManagementReportSchedule>("/management/report-schedules", { method: "POST", body: parsed.data }),
  );
  if (result.ok) revalidatePath("/management/reports");
  return result;
}

export async function setReportScheduleStatus(id: string, status: "active" | "paused", version: number): Promise<ActionResult<ManagementReportSchedule>> {
  const result = await actionResult(() =>
    api<ManagementReportSchedule>(`/management/report-schedules/${id}/status`, { method: "POST", body: { status, version } }),
  );
  if (result.ok) revalidatePath("/management/reports");
  return result;
}
