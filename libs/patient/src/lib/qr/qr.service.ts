import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import {
  type Actor,
  APP_CONFIG,
  type AppConfig,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  NotFoundError,
  type RequestMetadata,
  VersionConflictError,
} from "@healthcare/core";
import { organization, OrganizationService } from "@healthcare/organization";
import { CARD_STOCK, renderQrCards } from "@healthcare/pdf";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { patient, patientContactPoint, type PatientRecord } from "../patient.schema";
import { patientPortalAccount } from "../portal/portal.schema";
import { displayName, type PatientSummary, toSummary } from "../patient.views";
import type { patientQrSettingSchema } from "./qr.dto";
import { encodeQrPayload, generateQrToken, parseQrPayload } from "./qr.rules";
import {
  type PatientQrCodeRecord,
  type PatientQrContent,
  type PatientQrIssuedVia,
  patientQrCode,
  patientQrSetting,
  type PatientQrSettingRecord,
} from "./qr.schema";

export interface PatientQrSettingView {
  enabled: boolean;
  issueAtRegistration: boolean;
  inviteAtRegistration: boolean;
  content: PatientQrContent;
  version: number;
  updatedAt: Date | null;
}

/** What a scanned MyHealth card pre-fills in activation (open invitations only). */
export interface CardActivation {
  patientNumber: string;
  givenName: string;
  birthDate: string;
  email: string | null;
}

export interface PatientQrView {
  id: string;
  status: "active" | "revoked";
  content: PatientQrContent;
  issuedVia: PatientQrIssuedVia;
  issuedAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
}

/** What a member of staff sees of a patient's codes. `payload` is what the active code encodes, for drawing it. */
export interface PatientQrState {
  enabled: boolean;
  active: (PatientQrView & { payload: string }) | null;
  history: PatientQrView[];
}

/** What MyHealth shows the patient of their own code: whether the clinic uses codes, whether theirs was issued, and what to draw. */
export interface PortalQrView {
  enabled: boolean;
  /** An active code exists (issued by the clinic); the patient cannot issue their own. */
  issued: boolean;
  /** The check-in key to draw as a QR code; null while not enabled or not issued. */
  payload: string | null;
  patientNumber: string;
}

const DEFAULT_SETTING: PatientQrSettingView = {
  enabled: false,
  issueAtRegistration: true,
  inviteAtRegistration: false,
  content: "token",
  version: 0,
  updatedAt: null,
};

function settingView(row: PatientQrSettingRecord | undefined): PatientQrSettingView {
  if (!row) return DEFAULT_SETTING;
  return {
    enabled: row.enabled,
    issueAtRegistration: row.issueAtRegistration,
    inviteAtRegistration: row.inviteAtRegistration,
    content: row.content,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function codeView(row: PatientQrCodeRecord): PatientQrView {
  return {
    id: row.id,
    status: row.status,
    content: row.content,
    issuedVia: row.issuedVia,
    issuedAt: row.issuedAt,
    revokedAt: row.revokedAt,
    revokeReason: row.revokeReason,
  };
}

/**
 * Patient QR codes: the organization's setting, issuing at registration or from the record, revoking, printing a card
 * and resolving a scan. A code encodes only a key (an opaque token or the patient number): a scan tells an
 * authenticated, authorized member of staff which record to open and grants nothing. Neither payloads nor tokens are
 * written to the audit trail.
 */
@Injectable()
export class PatientQrService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly organizations: OrganizationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** What the code encodes; a portal link needs the portal's address (`PORTAL_BASE_URL`). */
  private payload(row: Pick<PatientQrCodeRecord, "content" | "token">, patientNumber: string): string {
    return encodeQrPayload(row.content, row.token, patientNumber, this.config.PORTAL_BASE_URL);
  }

  private requirePortalAddress(content: PatientQrContent): void {
    if (content === "portal_link" && !this.config.PORTAL_BASE_URL) {
      throw new BusinessRuleError("MyHealth links need PORTAL_BASE_URL to be set for the API", "portal_link_unavailable");
    }
  }

  async setting(organizationId: string, executor: DbExecutor = this.db): Promise<PatientQrSettingView> {
    const [row] = await executor.select().from(patientQrSetting).where(eq(patientQrSetting.organizationId, organizationId));
    return settingView(row);
  }

  async setSetting(actor: Actor, input: z.infer<typeof patientQrSettingSchema>): Promise<PatientQrSettingView> {
    this.requirePortalAddress(input.content);
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(patientQrSetting).where(eq(patientQrSetting.organizationId, actor.organizationId)).for("update");
      if ((current?.version ?? 0) !== input.version) throw new VersionConflictError("Patient QR setting", input.version);
      const values = {
        enabled: input.enabled,
        issueAtRegistration: input.issueAtRegistration,
        inviteAtRegistration: input.inviteAtRegistration,
        content: input.content,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      if (current)
        await tx
          .update(patientQrSetting)
          .set({ ...values, version: current.version + 1 })
          .where(eq(patientQrSetting.organizationId, actor.organizationId));
      else await tx.insert(patientQrSetting).values({ organizationId: actor.organizationId, ...values });
      const before = settingView(current);
      await this.audit.record(tx, actor, {
        action: "patient.qr-setting.update",
        resourceType: "organization",
        resourceId: actor.organizationId,
        changes: {
          enabled: { from: before.enabled, to: input.enabled },
          issueAtRegistration: { from: before.issueAtRegistration, to: input.issueAtRegistration },
          inviteAtRegistration: { from: before.inviteAtRegistration, to: input.inviteAtRegistration },
          content: { from: before.content, to: input.content },
        },
      });
    });
    return this.setting(actor.organizationId);
  }

  /** Issues the patient's first code in the registration's transaction when the organization's setting (and the registering person) say so. */
  async issueAtRegistration(tx: DbExecutor, actor: Actor, created: PatientRecord, requested: boolean | undefined): Promise<boolean> {
    const setting = await this.setting(actor.organizationId, tx);
    if (!setting.enabled || !(requested ?? setting.issueAtRegistration)) return false;
    await this.insertCode(tx, actor, created.id, setting.content, "registration");
    return true;
  }

  async state(actor: Actor, patientId: string): Promise<PatientQrState> {
    const record = await this.findPatient(this.db, actor.organizationId, patientId);
    const setting = await this.setting(actor.organizationId);
    const rows = await this.db
      .select()
      .from(patientQrCode)
      .where(and(eq(patientQrCode.organizationId, actor.organizationId), eq(patientQrCode.patientId, patientId)))
      .orderBy(desc(patientQrCode.issuedAt));
    const active = rows.find((r) => r.status === "active");
    await this.audit.recordStandalone(actor, { action: "patient.qr.view", resourceType: "patient_qr_code", resourceId: active?.id, patientId: record.id });
    return {
      enabled: setting.enabled,
      active: active ? { ...codeView(active), payload: this.payload(active, record.patientNumber) } : null,
      history: rows.filter((r) => r.status === "revoked").map(codeView),
    };
  }

  /**
   * The patient's own active code for MyHealth, to show at the front desk. It is the check-in key itself (never the activation
   * link a `portal_link` card carries), drawn from the same code staff scan; the patient cannot issue, replace or revoke it
   * (the clinic does, from the record). Viewing is audited without the key.
   */
  async portalCode(audit: PatientAuditContext, organizationId: string, patientId: string): Promise<PortalQrView> {
    const record = await this.findPatient(this.db, organizationId, patientId);
    const setting = await this.setting(organizationId);
    const [active] = setting.enabled
      ? await this.db
          .select()
          .from(patientQrCode)
          .where(and(eq(patientQrCode.organizationId, organizationId), eq(patientQrCode.patientId, patientId), eq(patientQrCode.status, "active")))
      : [];
    await this.audit.recordStandalone(audit, {
      action: "portal.qr-view",
      resourceType: "patient_qr_code",
      resourceId: active?.id,
      patientId: record.id,
    });
    const content = active?.content === "portal_link" ? "token" : active?.content;
    return {
      enabled: setting.enabled,
      issued: Boolean(active),
      payload: active && content ? encodeQrPayload(content, active.token, record.patientNumber) : null,
      patientNumber: record.patientNumber,
    };
  }

  async issue(actor: Actor, patientId: string): Promise<PatientQrView> {
    return this.db.transaction(async (tx) => {
      const record = await this.findPatient(tx, actor.organizationId, patientId);
      const setting = await this.setting(actor.organizationId, tx);
      if (!setting.enabled) throw new BusinessRuleError("Patient QR codes are not turned on for this organization", "qr_disabled");
      const row = await this.insertCode(tx, actor, record.id, setting.content, "patient_record");
      return codeView(row);
    });
  }

  async revoke(actor: Actor, patientId: string, reason: string): Promise<PatientQrView> {
    return this.db.transaction(async (tx) => {
      const record = await this.findPatient(tx, actor.organizationId, patientId);
      const revoked = await this.revokeActive(tx, actor, record.id, reason);
      if (!revoked) throw new NotFoundError("Active QR code");
      return codeView(revoked);
    });
  }

  /**
   * A new code in place of the current one, in one step: the active code (if any) is revoked with the reason and a new one is
   * issued with what the organization's setting holds now (so it also moves a card to a changed setting). The old card stops
   * working at once.
   */
  async regenerate(actor: Actor, patientId: string, reason: string): Promise<PatientQrView> {
    return this.db.transaction(async (tx) => {
      const record = await this.findPatient(tx, actor.organizationId, patientId);
      const setting = await this.setting(actor.organizationId, tx);
      if (!setting.enabled) throw new BusinessRuleError("Patient QR codes are not turned on for this organization", "qr_disabled");
      await this.revokeActive(tx, actor, record.id, reason);
      return codeView(await this.insertCode(tx, actor, record.id, setting.content, "patient_record"));
    });
  }

  private async revokeActive(tx: DbExecutor, actor: Actor, patientId: string, reason: string): Promise<PatientQrCodeRecord | undefined> {
    const [active] = await tx
      .select()
      .from(patientQrCode)
      .where(and(eq(patientQrCode.organizationId, actor.organizationId), eq(patientQrCode.patientId, patientId), eq(patientQrCode.status, "active")))
      .for("update");
    if (!active) return undefined;
    const [revoked] = await tx
      .update(patientQrCode)
      .set({ status: "revoked", revokedBy: actor.userId, revokedAt: new Date(), revokeReason: reason })
      .where(eq(patientQrCode.id, active.id))
      .returning();
    if (!revoked) throw new Error("QR revoke returned no row");
    await this.audit.record(tx, actor, { action: "patient.qr.revoke", resourceType: "patient_qr_code", resourceId: revoked.id, patientId, reason });
    await this.events.record(tx, {
      type: "PatientQrRevoked",
      organizationId: actor.organizationId,
      aggregateType: "patient",
      aggregateId: patientId,
      patientId,
      payload: { qrCodeId: revoked.id, patientId },
    });
    return revoked;
  }

  /** Resolves what a scanner delivered to a patient summary. A retired (merged) record resolves to its survivor. */
  async scan(actor: Actor, payload: string): Promise<{ patient: PatientSummary; qrCodeId: string }> {
    const deny = async (code: string, qrCodeId?: string, patientId?: string): Promise<void> => {
      await this.audit.recordStandalone(actor, {
        action: "patient.qr.scan",
        resourceType: "patient_qr_code",
        resourceId: qrCodeId,
        patientId,
        outcome: "denied",
        metadata: { reason: code },
      });
    };
    const parsed = parseQrPayload(payload);
    if (!parsed) {
      await deny("qr_not_recognised");
      throw new BusinessRuleError("This is not a patient QR code", "qr_not_recognised");
    }
    const setting = await this.setting(actor.organizationId);
    if (!setting.enabled) {
      await deny("qr_disabled");
      throw new BusinessRuleError("Patient QR codes are not turned on", "qr_disabled");
    }

    const found =
      parsed.kind === "token"
        ? await this.db
            .select({ code: patientQrCode, patient })
            .from(patientQrCode)
            .innerJoin(patient, and(eq(patient.organizationId, patientQrCode.organizationId), eq(patient.id, patientQrCode.patientId)))
            .where(and(eq(patientQrCode.organizationId, actor.organizationId), eq(patientQrCode.token, parsed.token)))
        : await this.db
            .select({ code: patientQrCode, patient })
            .from(patient)
            .innerJoin(patientQrCode, and(eq(patientQrCode.organizationId, patient.organizationId), eq(patientQrCode.patientId, patient.id)))
            .where(and(eq(patient.organizationId, actor.organizationId), eq(patient.patientNumber, parsed.patientNumber)))
            .orderBy(desc(patientQrCode.issuedAt));
    // A patient-number code is accepted while the patient has an active code; otherwise the newest (revoked) one decides.
    const hit = found.find((r) => r.code.status === "active") ?? found[0];
    if (!hit) {
      await deny("qr_not_found");
      throw new NotFoundError("QR code");
    }
    if (hit.code.status === "revoked") {
      await deny("qr_revoked", hit.code.id, hit.patient.id);
      throw new BusinessRuleError("This QR code was revoked. Ask the patient for another form of identification.", "qr_revoked");
    }

    let target = hit.patient;
    let resolvedFrom: PatientSummary["resolvedFrom"] = null;
    if (target.mergedIntoPatientId) {
      const survivor = await this.findPatient(this.db, actor.organizationId, target.mergedIntoPatientId);
      resolvedFrom = { id: target.id, patientNumber: target.patientNumber };
      target = survivor;
    }
    await this.audit.recordStandalone(actor, { action: "patient.qr.scan", resourceType: "patient_qr_code", resourceId: hit.code.id, patientId: target.id });
    return { patient: { ...toSummary(target), resolvedFrom }, qrCodeId: hit.code.id };
  }

  /**
   * MyHealth activation, step one (public): a patient who scanned a card with a MyHealth link learns which patient number
   * to activate. Only while the clinic has invited them and the invitation is still open, and only their number and first
   * name come back; the date of birth and the one-time activation code are still checked by activation itself.
   * Every refusal is the same 404.
   */
  async activationFromCard(organizationCode: string, payload: string, request: RequestMetadata): Promise<CardActivation> {
    const parsed = parseQrPayload(payload);
    const [org] = await this.db.select({ id: organization.id }).from(organization).where(eq(organization.code, organizationCode));
    const [hit] =
      org && parsed?.kind === "token"
        ? await this.db
            .select({ code: patientQrCode, patient, account: patientPortalAccount })
            .from(patientQrCode)
            .innerJoin(patient, and(eq(patient.organizationId, patientQrCode.organizationId), eq(patient.id, patientQrCode.patientId)))
            .innerJoin(
              patientPortalAccount,
              and(eq(patientPortalAccount.organizationId, patient.organizationId), eq(patientPortalAccount.patientId, patient.id)),
            )
            .where(
              and(
                eq(patientQrCode.organizationId, org.id),
                eq(patientQrCode.token, parsed.token),
                eq(patientQrCode.status, "active"),
                eq(patientQrCode.content, "portal_link"),
              ),
            )
        : [];
    const open = !!hit && hit.account.status === "invited" && !!hit.account.activationExpiresAt && hit.account.activationExpiresAt > new Date();
    await this.audit.recordStandalone(
      { kind: "anonymous", organizationId: org?.id, request },
      {
        action: "portal.activation-card",
        resourceType: "patient_qr_code",
        resourceId: hit?.code.id,
        patientId: open ? hit.patient.id : undefined,
        outcome: open ? "success" : "denied",
      },
    );
    if (!open) throw new NotFoundError("Card");
    // The patient's primary email on record, to start the form with; the date of birth too. Only the one-time activation code
    // (and the patient's own password) are left to enter; activation still checks the date of birth and the code itself.
    const [contact] = await this.db
      .select({ value: patientContactPoint.value })
      .from(patientContactPoint)
      .where(
        and(
          eq(patientContactPoint.organizationId, org!.id),
          eq(patientContactPoint.patientId, hit.patient.id),
          eq(patientContactPoint.system, "email"),
          eq(patientContactPoint.status, "active"),
        ),
      )
      .orderBy(desc(patientContactPoint.isPrimary), desc(patientContactPoint.createdAt))
      .limit(1);
    return { patientNumber: hit.patient.patientNumber, givenName: hit.patient.givenName, birthDate: hit.patient.birthDate, email: contact?.value ?? null };
  }

  /** The patient card as a PDF (QR code, name, number); printing is audited. */
  async cardPdf(actor: Actor, patientId: string): Promise<Buffer> {
    const record = await this.findPatient(this.db, actor.organizationId, patientId);
    const [active] = await this.db
      .select()
      .from(patientQrCode)
      .where(and(eq(patientQrCode.organizationId, actor.organizationId), eq(patientQrCode.patientId, record.id), eq(patientQrCode.status, "active")));
    if (!active) throw new NotFoundError("Active QR code");
    const organization = await this.organizations.getOrganization(actor.organizationId);
    const pdf = await renderQrCards(
      CARD_STOCK,
      [
        {
          qr: this.payload(active, record.patientNumber),
          heading: organization.name,
          lines: [
            { text: displayName(record), bold: true, size: 9, maxLines: 2 },
            { text: record.patientNumber, bold: true, size: 11 },
          ],
          footer:
            active.content === "portal_link"
              ? "Scan with your phone to set up MyHealth. Show it at the front desk. Tell the clinic if it is lost."
              : "Show this card at the front desk. Tell the clinic if it is lost.",
        },
      ],
      { title: "Patient card" },
    );
    await this.audit.recordStandalone(actor, { action: "patient.qr.print", resourceType: "patient_qr_code", resourceId: active.id, patientId: record.id });
    return pdf;
  }

  private async insertCode(tx: DbExecutor, actor: Actor, patientId: string, content: PatientQrContent, via: PatientQrIssuedVia): Promise<PatientQrCodeRecord> {
    this.requirePortalAddress(content);
    const [existing] = await tx
      .select({ id: patientQrCode.id })
      .from(patientQrCode)
      .where(and(eq(patientQrCode.organizationId, actor.organizationId), eq(patientQrCode.patientId, patientId), eq(patientQrCode.status, "active")));
    if (existing) throw new ConflictError("The patient already has an active QR code. Revoke it first to issue another.", undefined, "qr_already_active");
    const [row] = await tx
      .insert(patientQrCode)
      .values({ organizationId: actor.organizationId, patientId, content, token: generateQrToken(), issuedVia: via, issuedBy: actor.userId })
      .returning();
    if (!row) throw new Error("QR insert returned no row");
    await this.audit.record(tx, actor, {
      action: "patient.qr.issue",
      resourceType: "patient_qr_code",
      resourceId: row.id,
      patientId,
      metadata: { content, via },
    });
    await this.events.record(tx, {
      type: "PatientQrIssued",
      organizationId: actor.organizationId,
      aggregateType: "patient",
      aggregateId: patientId,
      patientId,
      payload: { qrCodeId: row.id, patientId },
    });
    return row;
  }

  private async findPatient(executor: DbExecutor, organizationId: string, patientId: string): Promise<PatientRecord> {
    const [row] = await executor
      .select()
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.id, patientId)));
    if (!row) throw new NotFoundError("Patient");
    if (row.status === "merged") throw new BusinessRuleError("This record was merged into another; use the surviving record", "patient_merged");
    return row;
  }
}
