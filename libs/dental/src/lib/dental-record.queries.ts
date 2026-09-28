import { Injectable } from "@nestjs/common";
import { DentalChartService } from "./chart/dental-chart.service";
import { DentalPerioService } from "./periodontal/dental-perio.service";
import { DentalProcedureService } from "./procedures/dental-procedure.service";

/**
 * A patient's dental record for a record export (FHIR): every procedure (entered-in-error ones flagged), the current
 * chart, and every periodontal chart with its measurements. Not audited here: the caller audits the access it serves.
 */
@Injectable()
export class DentalRecordQueries {
  constructor(
    private readonly procedures: DentalProcedureService,
    private readonly chart: DentalChartService,
    private readonly perio: DentalPerioService,
  ) {}

  async patientRecord(organizationId: string, patientId: string) {
    const [procedures, chart, perioCharts] = await Promise.all([
      this.procedures.forPatient(organizationId, patientId, 1000),
      this.chart.chart(organizationId, patientId),
      this.perio.withMeasurements(organizationId, patientId),
    ]);
    return { procedures, chart, perioCharts };
  }
}
