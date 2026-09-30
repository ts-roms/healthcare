import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { INSTRUMENT_PROTOCOLS, SPECIMEN_ID_FIELDS } from "./instrument-interface.ports";

export const instrumentInterfaceSchema = z
  .object({
    protocol: z.enum(INSTRUMENT_PROTOCOLS),
    specimenIdField: z.enum([...SPECIMEN_ID_FIELDS.hl7v2, ...SPECIMEN_ID_FIELDS.astm]),
    enabled: z.boolean(),
    version: z.number().int().positive().optional(),
  })
  .refine((v) => (SPECIMEN_ID_FIELDS[v.protocol] as readonly string[]).includes(v.specimenIdField), {
    message: "The specimen field does not belong to this protocol",
    path: ["specimenIdField"],
  });
export class InstrumentInterfaceDto extends createZodDto(instrumentInterfaceSchema) {}

export const instrumentTestCodeSchema = z.object({
  analyzerCode: z.string().trim().min(1).max(60),
  /** Null removes the mapping. */
  testId: z.uuid().nullable(),
});
export class InstrumentTestCodeDto extends createZodDto(instrumentTestCodeSchema) {}

export const instrumentMessageSchema = z.object({ message: z.string().min(1).max(1_048_576) });
export class InstrumentMessageDto extends createZodDto(instrumentMessageSchema) {}

export const instrumentResultQuerySchema = z.object({
  state: z.enum(["pending", "decided"]).default("pending"),
  instrumentId: z.uuid().optional(),
});
export class InstrumentResultQueryDto extends createZodDto(instrumentResultQuerySchema) {}

export const dismissInstrumentResultSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export class DismissInstrumentResultDto extends createZodDto(dismissInstrumentResultSchema) {}
