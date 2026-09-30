import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq } from "drizzle-orm";
import { patientMessageThread } from "@healthcare/patient";

/** Who has a conversation, for routing the notice of a patient's message. */
@Injectable()
export class PatientMessageNoticeSource {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async assignedTo(organizationId: string, threadId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ assignedTo: patientMessageThread.assignedTo })
      .from(patientMessageThread)
      .where(and(eq(patientMessageThread.organizationId, organizationId), eq(patientMessageThread.id, threadId)));
    return row?.assignedTo ?? null;
  }
}
