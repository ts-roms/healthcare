"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { ComplianceReview } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const reviewSchema = z.object({
  area: z.enum(["billing_tax", "procurement", "controlled_drugs", "laboratory_licensing", "doh_reporting", "data_privacy", "dental_estimates"]),
  outcome: z.enum(["validated", "changes_needed"]),
  reviewerName: z.string().trim().min(2, "Name the reviewer.").max(120),
  reviewerRole: z.string().trim().min(2, "Give the reviewer's role.").max(120),
  reference: z.string().trim().min(3, "Say what the review was made against.").max(500),
  reviewedOn: z.iso.date("Choose the review date."),
  note: z.string().trim().max(1000).optional(),
});

export async function recordComplianceReview(input: z.input<typeof reviewSchema>): Promise<ActionResult<ComplianceReview>> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid review." };
  const result = await actionResult(() =>
    api<ComplianceReview>("/compliance/reviews", { method: "POST", body: { ...parsed.data, note: parsed.data.note || undefined } }),
  );
  if (result.ok) revalidatePath("/admin/compliance");
  return result;
}
