import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { PROXY_BASES, PROXY_RELATIONSHIPS, PROXY_SCOPES } from "./proxy.rules";

export const grantProxySchema = z.object({
  /** The person who will act, by patient number: they need their own MyHealth account. */
  guardianPatientNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^P\d{8}$/, "Enter the guardian's patient number, like P00000123"),
  relationship: z.enum(PROXY_RELATIONSHIPS),
  basis: z.enum(PROXY_BASES),
  scopes: z
    .array(z.enum(PROXY_SCOPES))
    .min(1)
    .default(["view", "act"])
    .refine((s) => s.includes("view"), "Acting needs the right to view"),
  /** What was checked, in a few words (documents seen, who verified): no clinical detail. */
  verificationNote: z.string().trim().min(5, "Say what was checked").max(500),
  /** Optional end date (the day after which access stops). */
  expiresOn: z.iso.date().optional(),
});
export class GrantProxyDto extends createZodDto(grantProxySchema) {}

export const revokeProxySchema = z.object({ reason: z.string().trim().min(3, "Say why").max(500) });
export class RevokeProxyDto extends createZodDto(revokeProxySchema) {}
