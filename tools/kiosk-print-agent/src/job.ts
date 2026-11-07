import { z } from "zod";

/**
 * What the API hands the agent for one ticket. The agent trusts nothing it receives: a job that does not match this shape is
 * refused (and reported as failed), never printed.
 */
export const agentJobSchema = z.object({
  id: z.uuid(),
  attempt: z.number().int().min(1).max(10),
  ticket: z.string().regex(/^[A-Z]-[0-9]{3,6}$/, "not a queue ticket"),
  serviceName: z.string().trim().min(1).max(100),
  facilityName: z.string().trim().min(1).max(200),
  issuedAt: z.iso.datetime({ offset: true }),
  instructions: z.string().trim().min(1).max(300),
});

export type AgentJob = z.infer<typeof agentJobSchema>;

/** The shape `POST /kiosk/print/claim` answers: a job, or null when nothing waits. */
export const claimAnswerSchema = z.object({ job: agentJobSchema.nullable() });

/** The job as far as it can be read, for reporting a refusal; null when it has no usable id. */
export function jobIdOf(raw: unknown): string | null {
  const id = (raw as { job?: { id?: unknown } } | null)?.job?.id;
  return typeof id === "string" && z.uuid().safeParse(id).success ? id : null;
}
