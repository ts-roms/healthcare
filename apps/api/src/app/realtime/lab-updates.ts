import type { DomainEventRecord } from "@healthcare/core";

/** Laboratory events that change what a worklist, the critical-results list or the laboratory dashboard shows. */
export const LAB_REALTIME_EVENTS = [
  "LaboratoryOrderCreated",
  "LaboratoryOrderCancelled",
  "LaboratoryOrderCompleted",
  "SpecimenCollected",
  "SpecimenReceived",
  "SpecimenRejected",
  "LaboratoryResultEntered",
  "LaboratoryResultVerified",
  "LaboratoryResultApproved",
  "LaboratoryResultReleased",
  "LaboratoryResultCorrectionStarted",
  "LaboratoryResultAmended",
  "LaboratoryResultCancelled",
  "CriticalResultRaised",
  "CriticalResultCommunicated",
  "CriticalResultAcknowledged",
] as const;

const KINDS: Record<string, LabUpdate["kind"]> = {
  lab_order: "order",
  lab_specimen: "specimen",
  lab_result: "result",
  lab_critical_alert: "critical",
};

/** What the socket says about a laboratory change: ids, a status and the critical flag — never values, names or numbers. */
export interface LabUpdate {
  event: string;
  kind: "order" | "specimen" | "result" | "critical";
  id: string;
  orderId: string | null;
  status: string | null;
  critical: boolean;
  occurredAt: string;
}

/**
 * The message for a laboratory event, built from an allow-list of fields (event payloads may grow; the socket must not
 * carry more than a screen needs to know it should re-read through the authorized API). Null when not for the socket.
 */
export function labUpdate(event: DomainEventRecord): LabUpdate | null {
  const kind = KINDS[event.aggregateType];
  if (!kind || !event.facilityId || !(LAB_REALTIME_EVENTS as readonly string[]).includes(event.eventType)) return null;
  const payload = event.payload ?? {};
  const text = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : null);
  return {
    event: event.eventType,
    kind,
    id: event.aggregateId,
    orderId: kind === "order" ? event.aggregateId : text("orderId"),
    status: text("status"),
    critical: kind === "critical" || payload["critical"] === true,
    occurredAt: new Date(event.occurredAt).toISOString(),
  };
}
