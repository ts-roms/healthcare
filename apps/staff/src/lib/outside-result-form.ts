import { z } from "zod";
import type { OutsideResult } from "./api/types";

export const SOURCE_KIND_LABEL: Record<OutsideResult["sourceKind"], string> = {
  laboratory: "Laboratory",
  hospital: "Hospital",
  clinic: "Clinic",
  other: "Other",
};

export const RECEIVED_FROM_LABEL: Record<OutsideResult["receivedFrom"], string> = {
  patient: "Brought by the patient",
  provider: "Sent by the provider",
  other: "Other",
};

/** What staff type for a filing; the API validates again and is authoritative. The report itself is the uploaded file. */
export interface OutsideResultForm {
  sourceName: string;
  sourceKind: OutsideResult["sourceKind"] | "";
  /** YYYY-MM-DD, the day the test was done as the report states it. */
  performedOn: string;
  tests: string;
  receivedFrom: OutsideResult["receivedFrom"] | "";
  notes: string;
}

export const BLANK_OUTSIDE_RESULT: OutsideResultForm = {
  sourceName: "",
  sourceKind: "laboratory",
  performedOn: "",
  tests: "",
  receivedFrom: "patient",
  notes: "",
};

export function outsideResultFormSchema(today: string) {
  return z.object({
    sourceName: z.string().trim().min(2, "Name the laboratory or hospital as written on the report.").max(200),
    sourceKind: z.enum(["laboratory", "hospital", "clinic", "other"], "Say what kind of provider it is."),
    performedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the day the test was done, as the report states it.")
      .refine((d) => d <= today, "The day cannot be in the future."),
    tests: z.string().trim().min(2, "Say which tests the report covers.").max(500),
    receivedFrom: z.enum(["patient", "provider", "other"], "Say how the report reached the clinic."),
    notes: z.string().trim().max(2000),
  });
}

/** The request body for filing (optional notes left out when empty). */
export function outsideResultPayload(form: z.output<ReturnType<typeof outsideResultFormSchema>>, documentId: string) {
  const { notes, ...rest } = form;
  return { documentId, ...rest, ...(notes ? { notes } : {}) };
}
