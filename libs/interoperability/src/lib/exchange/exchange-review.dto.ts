import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { EXCHANGE_STATUSES } from "./exchange.schema";

export const listExchangesSchema = z.object({
  /** attention: final without success and not yet resolved, plus queued exchanges that look stalled. */
  view: z.enum(["attention", "all"]).default("attention"),
  status: z.enum(EXCHANGE_STATUSES).optional(),
  system: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,48}$/)
    .optional(),
});
export class ListExchangesDto extends createZodDto(listExchangesSchema) {}

export const resolveExchangeSchema = z.object({ note: z.string().trim().min(3).max(500) });
export class ResolveExchangeDto extends createZodDto(resolveExchangeSchema) {}
