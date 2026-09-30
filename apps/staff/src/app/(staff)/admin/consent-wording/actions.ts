"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { ConsentTextVersion } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.
const schema = z.object({
  consentType: z.enum(["telemedicine", "data_sharing_hmo", "data_sharing_philhealth", "research"]),
  offered: z.boolean(),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(20_000).optional(),
  acknowledgement: z.string().trim().max(500).optional(),
});

/** Publishes a new version of a consent's wording, or stops offering it online (needs consent.wording.manage; audited). */
export async function publishConsentWording(input: z.input<typeof schema>): Promise<ActionResult<ConsentTextVersion>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the wording." };
  const { offered, title, body, acknowledgement } = parsed.data;
  if (offered && (!title || !body || !acknowledgement))
    return { ok: false, message: "A wording needs a title, its text and the statement the patient confirms." };
  const result = await actionResult(() =>
    api<ConsentTextVersion>("/consent-texts", { method: "POST", body: offered ? parsed.data : { consentType: parsed.data.consentType, offered: false } }),
  );
  if (result.ok) revalidatePath("/admin/consent-wording");
  return result;
}
