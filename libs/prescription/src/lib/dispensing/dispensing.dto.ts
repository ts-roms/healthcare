import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const dispenseSchema = z.object({
  lines: z
    .array(
      z.object({
        prescriptionItemId: z.uuid(),
        /** The inventory item handed over (a medicine or supply). */
        inventoryItemId: z.uuid(),
        /** A storage location of the selected facility (e.g. the pharmacy). */
        locationId: z.uuid(),
        /** In the inventory item's stock unit. */
        quantity: z.number().int().positive().max(100_000),
      }),
    )
    .min(1)
    .max(20),
  note: z.string().trim().max(500).optional(),
});
export class DispenseDto extends createZodDto(dispenseSchema) {}

export const reverseDispenseSchema = z.object({ reason: z.string().trim().min(5).max(500) });
export class ReverseDispenseDto extends createZodDto(reverseDispenseSchema) {}

export const recentDispensesSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
    .optional(),
});
export class RecentDispensesDto extends createZodDto(recentDispensesSchema) {}
