import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, reportingDay, reportingFacility, reportingRange, type ReportingWindow } from "@healthcare/core";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { labOrder, labOrderItem, labResult, labSpecimen, labTest } from "../laboratory.schema";

/**
 * Laboratory figures for management reporting over a window: orders and tests ordered, first releases with the
 * collection-to-release turnaround (and how many met the test's own target), corrections released, specimens
 * rejected, and the most ordered tests. Counts only: no patient or value.
 */
@Injectable()
export class LabReportingQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async figures(organizationId: string, window: ReportingWindow) {
    const ordersWhere = and(
      eq(labOrder.organizationId, organizationId),
      reportingRange(labOrder.orderedAt, window),
      reportingFacility(labOrder.facilityId, window),
    );
    const releasedWhere = and(
      eq(labResult.organizationId, organizationId),
      reportingRange(labResult.releasedAt, window),
      reportingFacility(labResult.facilityId, window),
    );
    const [orders, tests, releases, rejected, topTests, daily] = await Promise.all([
      this.db
        .select({
          orders: sql<number>`count(*)::int`,
          stat: sql<number>`count(*) filter (where ${labOrder.priority} = 'stat')::int`,
          cancelled: sql<number>`count(*) filter (where ${labOrder.status} = 'cancelled')::int`,
        })
        .from(labOrder)
        .where(ordersWhere),
      this.db
        .select({ ordered: sql<number>`count(*) filter (where ${labOrderItem.status} <> 'cancelled')::int` })
        .from(labOrderItem)
        .innerJoin(labOrder, eq(labOrder.id, labOrderItem.orderId))
        .where(ordersWhere),
      this.db
        .select({
          // A result's first version released is the test's release; later versions are corrections.
          released: sql<number>`count(*) filter (where ${labResult.versionNumber} = 1)::int`,
          corrections: sql<number>`count(*) filter (where ${labResult.versionNumber} > 1)::int`,
          averageTurnaroundMinutes: sql<number | null>`round(avg(extract(epoch from ${labResult.releasedAt} - ${labSpecimen.collectedAt}) / 60)
            filter (where ${labResult.versionNumber} = 1))::int`,
          withTarget: sql<number>`count(*) filter (where ${labResult.versionNumber} = 1 and ${labTest.turnaroundMinutes} is not null and ${labSpecimen.collectedAt} is not null)::int`,
          withinTarget: sql<number>`count(*) filter (where ${labResult.versionNumber} = 1 and ${labTest.turnaroundMinutes} is not null
            and ${labResult.releasedAt} <= ${labSpecimen.collectedAt} + make_interval(mins => ${labTest.turnaroundMinutes}))::int`,
        })
        .from(labResult)
        .innerJoin(labOrderItem, eq(labOrderItem.id, labResult.orderItemId))
        .innerJoin(labTest, eq(labTest.id, labResult.testId))
        .leftJoin(labSpecimen, eq(labSpecimen.id, labOrderItem.specimenId))
        .where(releasedWhere),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(labSpecimen)
        .where(
          and(
            eq(labSpecimen.organizationId, organizationId),
            reportingRange(labSpecimen.rejectedAt, window),
            reportingFacility(labSpecimen.facilityId, window),
          ),
        ),
      this.db
        .select({ testId: labOrderItem.testId, name: sql<string>`max(${labOrderItem.testName})`, ordered: sql<number>`count(*)::int` })
        .from(labOrderItem)
        .innerJoin(labOrder, eq(labOrder.id, labOrderItem.orderId))
        .where(and(ordersWhere, ne(labOrderItem.status, "cancelled")))
        .groupBy(labOrderItem.testId)
        .orderBy(desc(sql`count(*)`))
        .limit(10),
      this.db
        .select({ date: reportingDay(labResult.releasedAt, window), released: sql<number>`count(*)::int` })
        .from(labResult)
        .where(and(releasedWhere, eq(labResult.versionNumber, 1)))
        .groupBy(sql`1`),
    ]);
    const r = releases[0] ?? { released: 0, corrections: 0, averageTurnaroundMinutes: null, withTarget: 0, withinTarget: 0 };
    return {
      orders: orders[0] ?? { orders: 0, stat: 0, cancelled: 0 },
      testsOrdered: tests[0]?.ordered ?? 0,
      released: r.released,
      corrections: r.corrections,
      averageTurnaroundMinutes: r.averageTurnaroundMinutes,
      /** Share of first releases with a turnaround target that met it (null when none had a target). */
      withinTargetRate: r.withTarget ? Math.round((r.withinTarget / r.withTarget) * 1000) / 1000 : null,
      specimensRejected: rejected[0]?.count ?? 0,
      topTests: topTests,
      daily: daily.sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
}
