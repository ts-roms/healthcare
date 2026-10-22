"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import { getPractitioners, getVisitTypes } from "@/lib/api/clinic";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import { todayIn, visitStatusLabel } from "@/lib/clinic-mapping";
import type { AppointmentItem, AppointmentStatusApi, Page, PatientSummary, QueueVisit, VisitPriority, VisitStatus, VisitType } from "@/lib/api/types";

/**
 * Resolves what a scanner delivered. The API checks the QR code against the organization's active codes, audits the scan
 * (never the payload) and returns the minimal patient summary; opening the record is a separate, audited request.
 */
export async function scanPatientQr(payload: string): Promise<ActionResult<{ patient: PatientSummary }>> {
  const parsed = z.string().trim().min(1).max(200).safeParse(payload);
  if (!parsed.success) return { ok: false, message: "Scan a patient QR code." };
  return actionResult(() => api<{ patient: PatientSummary }>("/patient-qr/scan", { method: "POST", body: { payload: parsed.data } }));
}

/** What the clinic already knows about the scanned patient today, for the result card: the queue ticket and the booked appointment. */
export interface ScanDetails {
  visit: {
    id: string;
    ticket: string;
    status: VisitStatus;
    statusLabel: string;
    /** Still in the queue today (not seen, cancelled or gone). */
    open: boolean;
    priority: VisitPriority;
    arrivalMode: "walk_in" | "appointment";
    checkedInOnline: boolean;
    chiefComplaint: string | null;
    waitingMinutes: number;
    checkedInAt: string;
    servicePointName: string | null;
    calledTo: string | null;
  } | null;
  appointment: {
    id: string;
    startsAt: string;
    status: AppointmentStatusApi;
    visitTypeName: string | null;
    practitionerName: string | null;
    reason: string | null;
    mode: "in_person" | "telemedicine" | null;
  } | null;
}

const OPEN_VISIT: VisitStatus[] = ["waiting", "in_triage", "awaiting_consultation", "in_consultation"];

/**
 * Today's queue ticket and appointment of a scanned patient. Each part is read only with its own permission (queue and
 * appointments) and a failure leaves that part out: the scan itself never depends on it.
 */
export async function scanDetails(patientId: string): Promise<ScanDetails> {
  const empty: ScanDetails = { visit: null, appointment: null };
  if (!z.string().uuid().safeParse(patientId).success) return empty;
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!facility) return empty;
  const today = todayIn(facility.timezone);

  const visits = can(session, "clinic.queue.read")
    ? await api<QueueVisit[]>("/queue", { query: { includeClosed: "true" } }).catch(() => [] as QueueVisit[])
    : [];
  const mine = visits.filter((v) => v.patientId === patientId);
  const current = mine.find((v) => OPEN_VISIT.includes(v.status)) ?? mine.sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt))[0];

  let appointment: ScanDetails["appointment"] = null;
  if (can(session, "appointment.read")) {
    const [page, types, practitioners] = await Promise.all([
      api<Page<AppointmentItem>>("/appointments", { query: { facilityId: facility.id, patientId, date: today, pageSize: 20 } }).catch(() => null),
      getVisitTypes().catch(() => [] as VisitType[]),
      getPractitioners().catch(() => []),
    ]);
    const next = (page?.items ?? []).filter((a) => a.status !== "cancelled" && a.status !== "no_show").sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    if (next) {
      const type = types.find((t) => t.id === next.visitTypeId);
      appointment = {
        id: next.id,
        startsAt: next.startsAt,
        status: next.status,
        visitTypeName: type?.name ?? null,
        practitionerName: practitioners.find((p) => p.id === next.practitionerId)?.displayName ?? null,
        reason: next.reason,
        mode: type?.modality ?? null,
      };
    }
  }

  return {
    visit: current
      ? {
          id: current.id,
          ticket: current.ticket,
          status: current.status,
          statusLabel: visitStatusLabel(current.status),
          open: OPEN_VISIT.includes(current.status),
          priority: current.priority,
          arrivalMode: current.arrivalMode,
          checkedInOnline: current.checkedInVia === "patient_portal",
          chiefComplaint: current.chiefComplaint,
          waitingMinutes: current.waitingMinutes,
          checkedInAt: current.checkedInAt,
          servicePointName: current.servicePoint?.name ?? null,
          calledTo: current.calledTo,
        }
      : null,
    appointment,
  };
}
