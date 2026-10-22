"use server";

import { revalidatePath } from "next/cache";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";

/**
 * Signs a form the clinic asked for: the drawn signature and the password again (the API checks it, and a wrong one counts
 * toward the sign-in lockout). A minor's form is signed by a parent or guardian acting for them.
 */
export async function signForm(input: {
  requestId: string;
  password: string;
  strokes: number[][][];
}): Promise<Result<{ documentId: string; signedAt: string }>> {
  if (!UUID.test(input.requestId)) return { ok: false, message: "Unknown form." };
  if (!input.password) return { ok: false, message: "Enter your password to sign." };
  const result = await run(() =>
    portalApi<{ documentId: string; signedAt: string }>(`/portal/forms/${input.requestId}/sign`, {
      method: "POST",
      body: { password: input.password, strokes: input.strokes, understood: true },
    }),
  );
  if (result.ok) {
    revalidatePath("/forms");
    revalidatePath("/", "layout");
  }
  return result;
}
