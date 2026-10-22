import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const staffTourSettingSchema = z.object({
  enabled: z.boolean(),
  /** The version read; 0 when nothing was saved yet. */
  version: z.number().int().min(0),
});
export class StaffTourSettingDto extends createZodDto(staffTourSettingSchema) {}
