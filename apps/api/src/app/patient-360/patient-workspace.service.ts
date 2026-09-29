import { Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { ClinicQueries } from "@healthcare/clinic";
import { type Actor, actorUserId, NotFoundError, PH_TIMEZONE } from "@healthcare/core";
import { DentalRecordQueries } from "@healthcare/dental";
import { DocumentRecordQueries } from "@healthcare/documents";
import { LabRecordQueries } from "@healthcare/laboratory";
import { OrganizationService } from "@healthcare/organization";
import { PatientRecordService } from "@healthcare/patient";
import { orderCurrentEncounters, visiblePanels, WORKSPACE_LIMITS, type WorkspacePanel } from "./workspace.rules";

type Facility = { id: string; name: string } | null;

export interface WorkspaceDiagnosis {
  id: string;
  codeSystemKey: string | null;
  code: string | null;
  display: string;
  rank: "primary" | "secondary";
  certainty: "provisional" | "confirmed" | "refuted";
  isChronic: boolean;
  status: "active" | "resolved" | "entered_in_error";
}

export interface WorkspaceEncounter {
  id: string;
  facility: Facility;
  status: "in_progress" | "completed" | "entered_in_error";
  modality: string;
  appointmentId: string | null;
  startedAt: string;
  completedAt: string | null;
  practitionerName: string;
  visitTypeName: string | null;
  diagnoses: WorkspaceDiagnosis[];
}

export interface WorkspaceCurrentEncounter extends WorkspaceEncounter {
  /** The viewer is the responsible clinician. */
  mine: boolean;
  atSelectedFacility: boolean;
  /** A note draft has been saved (never its content). */
  hasNoteDraft: boolean;
}

/**
 * GET /patients/:id/workspace — what the Patient 360 workspace needs beyond the summary and the timeline. Each panel is
 * null when the caller may not read it (listed in `withheld`). Short display fields only: no notes, complaints,
 * reasons, result values or document contents.
 */
export interface PatientWorkspace {
  patientId: string;
  /** The selected facility (null when none is selected) and the time zone its dates are shown in. */
  facility: Facility;
  timeZone: string;
  currentEncounter: {
    /** Consultations in progress: the viewer's at the selected facility first. */
    encounters: WorkspaceCurrentEncounter[];
    /** The patient's visit in today's queue at the selected facility, when the viewer may read the queue. */
    visit: {
      id: string;
      status: string;
      queueNumber: number;
      priority: string;
      modality: string;
      visitTypeName: string;
      appointmentId: string | null;
      checkedInAt: string;
    } | null;
  } | null;
  encounterHistory: WorkspaceEncounter[] | null;
  criticalResults: Array<{
    id: string;
    facility: Facility;
    status: "open" | "communicated";
    raisedAt: string;
    orderId: string;
    orderNumber: string;
    testName: string;
  }> | null;
  labOrders: Array<{
    id: string;
    facility: Facility;
    orderNumber: string;
    priority: string;
    status: string;
    orderedAt: string;
    encounterId: string | null;
    tests: Array<{ id: string; testName: string; status: string }>;
  }> | null;
  dentalImages: Array<{ id: string; facility: Facility; kind: string; takenOn: string; teeth: string[] }> | null;
  documents: Array<{ id: string; facility: Facility; category: string; title: string; uploadedAt: string }> | null;
  withheld: WorkspacePanel[];
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

/**
 * Patient 360 workspace (CLAUDE.md §29, §39): the doctor's one-screen view, composed at the application layer from
 * each domain's small read query so no domain library depends on another. Panels are gated by the owning domain's
 * read permission; one `patient.workspace.view` audit per request (panels shown and withheld, counts, no content).
 */
@Injectable()
export class PatientWorkspaceService {
  constructor(
    private readonly patients: PatientRecordService,
    private readonly organizations: OrganizationService,
    private readonly clinic: ClinicQueries,
    private readonly lab: LabRecordQueries,
    private readonly dental: DentalRecordQueries,
    private readonly documents: DocumentRecordQueries,
    private readonly audit: AuditService,
  ) {}

  async workspace(actor: Actor, patientId: string): Promise<PatientWorkspace> {
    const organizationId = actor.organizationId;
    const briefs = await this.patients.briefs(organizationId, [patientId]);
    if (!briefs.has(patientId)) throw new NotFoundError("Patient");

    const facilities = await this.organizations.listFacilities(organizationId);
    const byId = new Map(facilities.map((f) => [f.id, f]));
    const facilityOf = (id: string | null | undefined): Facility => {
      const f = id ? byId.get(id) : undefined;
      return f ? { id: f.id, name: f.name } : null;
    };
    const selected = actor.facilityId ? byId.get(actor.facilityId) : undefined;
    const { included, withheld } = visiblePanels(actor.permissions);
    const has = (panel: WorkspacePanel) => included.has(panel);
    const none = Promise.resolve(null);

    const [encounters, visit, critical, orders, images, documents] = await Promise.all([
      has("current_encounter") || has("encounter_history")
        ? this.clinic.workspaceEncounters(organizationId, patientId, { open: WORKSPACE_LIMITS.openEncounters, recent: WORKSPACE_LIMITS.recentEncounters })
        : none,
      has("current_encounter") && selected && actor.permissions.has("clinic.queue.read")
        ? this.clinic.workspaceActiveVisit(organizationId, patientId, selected.id)
        : none,
      has("critical_results") ? this.lab.unacknowledgedCriticalAlerts(organizationId, patientId, WORKSPACE_LIMITS.criticalResults) : none,
      has("lab_orders") ? this.lab.openOrders(organizationId, patientId, WORKSPACE_LIMITS.labOrders) : none,
      has("dental_images") ? this.dental.workspaceImages(organizationId, patientId, WORKSPACE_LIMITS.dentalImages) : none,
      // One more than shown, so documents that are dental images (listed as images) can be left out.
      has("documents") ? this.documents.recentForPatient(organizationId, patientId, WORKSPACE_LIMITS.documents + WORKSPACE_LIMITS.dentalImages) : none,
    ]);

    const userId = actorUserId(actor);
    type EncounterRow = NonNullable<typeof encounters>["recent"][number];
    const toEncounter = (e: EncounterRow): WorkspaceEncounter => ({
      id: e.id,
      facility: facilityOf(e.facilityId),
      status: e.status,
      modality: e.modality,
      appointmentId: e.appointmentId,
      startedAt: iso(e.startedAt),
      completedAt: e.completedAt ? iso(e.completedAt) : null,
      practitionerName: e.practitionerName,
      visitTypeName: e.visitTypeName,
      diagnoses: e.diagnoses.map(({ encounterId: _encounterId, ...d }) => d),
    });

    const imageDocuments = new Set((images ?? []).map((i) => i.documentId));
    const result: PatientWorkspace = {
      patientId,
      facility: selected ? { id: selected.id, name: selected.name } : null,
      timeZone: selected?.timezone ?? PH_TIMEZONE,
      currentEncounter:
        has("current_encounter") && encounters
          ? {
              encounters: orderCurrentEncounters(
                encounters.open.map((e) => ({
                  ...toEncounter(e),
                  mine: !!userId && e.practitionerUserId === userId,
                  atSelectedFacility: !!selected && e.facilityId === selected.id,
                  hasNoteDraft: e.hasNoteDraft,
                })),
              ),
              visit: visit
                ? {
                    id: visit.id,
                    status: visit.status,
                    queueNumber: visit.queueNumber,
                    priority: visit.priority,
                    modality: visit.modality,
                    visitTypeName: visit.visitTypeName,
                    appointmentId: visit.appointmentId,
                    checkedInAt: iso(visit.checkedInAt),
                  }
                : null,
            }
          : null,
      encounterHistory: has("encounter_history") && encounters ? encounters.recent.map(toEncounter) : null,
      criticalResults: critical
        ? critical.map((c) => ({
            id: c.id,
            facility: facilityOf(c.facilityId),
            status: c.status === "communicated" ? "communicated" : "open",
            raisedAt: iso(c.raisedAt),
            orderId: c.orderId,
            orderNumber: c.orderNumber,
            testName: c.testName,
          }))
        : null,
      labOrders: orders
        ? orders.map((o) => ({
            id: o.id,
            facility: facilityOf(o.facilityId),
            orderNumber: o.orderNumber,
            priority: o.priority,
            status: o.status,
            orderedAt: iso(o.orderedAt),
            encounterId: o.encounterId,
            tests: o.tests,
          }))
        : null,
      dentalImages: images ? images.map((i) => ({ id: i.id, facility: facilityOf(i.facilityId), kind: i.kind, takenOn: i.takenOn, teeth: i.teeth })) : null,
      documents: documents
        ? documents
            .filter((d) => !imageDocuments.has(d.id))
            .slice(0, WORKSPACE_LIMITS.documents)
            .flatMap((d) =>
              d.uploadedAt ? [{ id: d.id, facility: facilityOf(d.facilityId), category: d.category, title: d.title, uploadedAt: iso(d.uploadedAt) }] : [],
            )
        : null,
      withheld,
    };

    await this.audit.recordStandalone(actor, {
      action: "patient.workspace.view",
      resourceType: "patient",
      resourceId: patientId,
      patientId,
      metadata: {
        panels: [...included],
        withheld,
        counts: {
          currentEncounters: result.currentEncounter?.encounters.length ?? null,
          encounterHistory: result.encounterHistory?.length ?? null,
          criticalResults: result.criticalResults?.length ?? null,
          labOrders: result.labOrders?.length ?? null,
          dentalImages: result.dentalImages?.length ?? null,
          documents: result.documents?.length ?? null,
        },
      },
    });
    return result;
  }
}
