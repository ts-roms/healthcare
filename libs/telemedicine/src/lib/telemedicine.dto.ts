import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const instructions = z.string().trim().min(1).max(4000);

export const daySchema = z.object({ date: z.iso.date().optional() });
export class DayDto extends createZodDto(daySchema) {}

export const endSchema = z.object({ patientInstructions: instructions.optional() });
export class EndDto extends createZodDto(endSchema) {}

export const escalateSchema = z.object({
  reason: z.string().trim().min(5, "Say why the patient needs in-person care").max(1000),
  patientInstructions: instructions.optional(),
});
export class EscalateDto extends createZodDto(escalateSchema) {}

export const instructionsSchema = z.object({ patientInstructions: instructions });
export class InstructionsDto extends createZodDto(instructionsSchema) {}
