import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const strokePoint = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

export const drawPractitionerSignatureSchema = z.object({
  /** Polylines of [x, y] in 0..1 inside the 3:1 signature box. */
  strokes: z.array(z.array(strokePoint).min(1).max(3000)).min(1).max(64),
});
export class DrawPractitionerSignatureDto extends createZodDto(drawPractitionerSignatureSchema) {}

export const updatePractitionerSignatureSettingSchema = z.object({
  enabled: z.boolean(),
  /** The version read (0 when the organization has never saved its own). */
  version: z.number().int().min(0),
});
export class UpdatePractitionerSignatureSettingDto extends createZodDto(updatePractitionerSignatureSettingSchema) {}
