import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq, gt, gte, isNull, lte, or } from "drizzle-orm";
import { dentalProcedure, dentalProcedureType } from "../dental.schema";

/**
 * The dental side of the assistant's `billing.uncharged-work` rule: procedures performed at a facility in a period and
 * not entered in error at a moment, with the procedure type's code (what billing maps a service to). Ids, codes and
 * times only; the API composes them with billing's charge state and audits the request.
 */
@Injectable()
export class DentalAssistantQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async proceduresPerformed(organizationId: string, facilityId: string, from: Date, to: Date, asOf: Date) {
    return this.db
      .select({ id: dentalProcedure.id, code: dentalProcedureType.code, name: dentalProcedureType.name, performedAt: dentalProcedure.performedAt })
      .from(dentalProcedure)
      .innerJoin(dentalProcedureType, eq(dentalProcedureType.id, dentalProcedure.procedureTypeId))
      .where(
        and(
          eq(dentalProcedure.organizationId, organizationId),
          eq(dentalProcedure.facilityId, facilityId),
          gte(dentalProcedure.performedAt, from),
          lte(dentalProcedure.performedAt, to),
          or(isNull(dentalProcedure.enteredInErrorAt), gt(dentalProcedure.enteredInErrorAt, asOf)),
        ),
      );
  }
}
