import { localDate, zonedToUtc } from "@healthcare/core";

/** Audit partitions are calendar months in this time zone (0110_audit_partitions.sql). */
export const AUDIT_TIME_ZONE = "Asia/Manila";

/** The first instant of the month `offsetMonths` from the one `now` falls in, in Asia/Manila. */
export function auditMonthStart(now: Date, offsetMonths: number): Date {
  const [year, month] = localDate(now, AUDIT_TIME_ZONE).split("-").map(Number) as [number, number];
  const index = year * 12 + (month - 1) + offsetMonths;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return zonedToUtc(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`, "00:00", AUDIT_TIME_ZONE);
}

export interface PartitionState {
  rangeTo: Date | null;
  isDefault: boolean;
  /** The partition's archive, if any (a failed one does not count). */
  archive: { status: "pending" | "running" | "verified"; removedAt: Date | null } | null;
}

/** A partition may be archived once its whole range is in the past (it ended before the current month began). */
export function archivable(partition: PartitionState, now: Date): boolean {
  if (partition.isDefault || !partition.rangeTo || partition.archive) return false;
  return partition.rangeTo.getTime() <= auditMonthStart(now, 0).getTime();
}

/**
 * Whether a partition may be removed: archived and verified, and its whole range ended at least `retentionMonths`
 * whole months before the current month began. Without a retention period nothing is removable. The database
 * function checks the same again (and that the archive still matches the partition).
 */
export function removable(partition: PartitionState, now: Date, retentionMonths: number | undefined): boolean {
  if (!retentionMonths || partition.isDefault || !partition.rangeTo) return false;
  if (partition.archive?.status !== "verified" || partition.archive.removedAt) return false;
  return partition.rangeTo.getTime() <= auditMonthStart(now, -retentionMonths).getTime();
}
