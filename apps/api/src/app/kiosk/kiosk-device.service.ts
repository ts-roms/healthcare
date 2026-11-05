import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { UsersService } from "@healthcare/auth";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  DomainEventPublisher,
  ForbiddenError,
  PgErrorCode,
  requireFacilityId,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { heartbeatSchema, registerDeviceSchema, updateDeviceSchema } from "./kiosk.dto";
import { type DeviceHealth, deviceHealth, type PrinterAvailability, printerAvailability } from "./kiosk.rules";
import { kioskDevice, type KioskDeviceRecord } from "./kiosk.schema";
import { assertVersion, found } from "./kiosk-support";

export interface KioskDeviceView {
  id: string;
  code: string;
  name: string;
  kind: KioskDeviceRecord["kind"];
  facilityId: string;
  status: KioskDeviceRecord["status"];
  health: DeviceHealth;
  heartbeatAt: Date | null;
  appVersion: string | null;
  printerStatus: KioskDeviceRecord["printerStatus"];
  /** Staff turned ticket printing on for this kiosk (a kiosk without a printer leaves it off). */
  printsTickets: boolean;
  /** The print agent account that serves this kiosk; null = any print agent of the facility. */
  printAgentUserId: string | null;
  /** Whether the printer is known to be working: from its last report and how recent that is (kiosks only). */
  printer: PrinterAvailability;
  printerHeartbeatAt: Date | null;
  version: number;
}

const view = (row: KioskDeviceRecord, now = new Date()): KioskDeviceView => ({
  id: row.id,
  code: row.code,
  name: row.name,
  kind: row.kind,
  facilityId: row.facilityId,
  status: row.status,
  health: deviceHealth(row, now),
  heartbeatAt: row.heartbeatAt,
  appVersion: row.appVersion,
  printerStatus: row.printerStatus,
  printsTickets: row.kind === "kiosk" && row.printsTickets,
  printAgentUserId: row.printAgentUserId,
  printer: row.kind === "kiosk" ? printerAvailability(row, now) : "none",
  printerHeartbeatAt: row.printerHeartbeatAt,
  version: row.version,
});

/**
 * Kiosk devices (docs/domains/kiosk.md). A kiosk is a staff account holding only the Patient kiosk role, registered
 * here as a device of one facility. The device's identity is its sign-in, never the code in its address, so a screen
 * cannot act as another kiosk by changing the URL.
 */
@Injectable()
export class KioskDeviceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly users: UsersService,
    private readonly organizations: OrganizationService,
  ) {}

  async list(actor: Actor): Promise<KioskDeviceView[]> {
    const facilityId = requireFacilityId(actor);
    const rows = await this.db
      .select()
      .from(kioskDevice)
      .where(and(eq(kioskDevice.organizationId, actor.organizationId), eq(kioskDevice.facilityId, facilityId)))
      .orderBy(asc(kioskDevice.name));
    const now = new Date();
    return rows.map((r) => view(r, now));
  }

  /** The facilities that have at least one kiosk in service (for MyHealth's notice to patients): names only. */
  async inServiceLocations(organizationId: string): Promise<{ available: boolean; locations: string[] }> {
    const rows = await this.db
      .selectDistinct({ facilityId: kioskDevice.facilityId })
      .from(kioskDevice)
      .where(and(eq(kioskDevice.organizationId, organizationId), eq(kioskDevice.kind, "kiosk"), eq(kioskDevice.status, "active")));
    const names: string[] = [];
    for (const { facilityId } of rows) {
      const site = await this.organizations.findFacility(organizationId, facilityId);
      if (site) names.push(site.name);
    }
    names.sort((x, y) => x.localeCompare(y));
    return { available: names.length > 0, locations: names };
  }

  async register(actor: Actor, input: z.infer<typeof registerDeviceSchema>): Promise<KioskDeviceView> {
    const facilityId = requireFacilityId(actor);
    // The account must be a device account at this facility and nothing more: a kiosk or a display is never given general
    // patient access.
    const display = input.kind === "display";
    const holders = await this.users.holdersOfRole(actor.organizationId, display ? "queue_display" : "kiosk_device", facilityId);
    if (!holders.some((u) => u.id === input.userId)) {
      throw display
        ? new BusinessRuleError("That account does not hold the Waiting-room display role at this facility", "not_a_display_account")
        : new BusinessRuleError("That account does not hold the Patient kiosk role at this facility", "not_a_kiosk_account");
    }
    const readers = await this.users.holdersOf(actor.organizationId, "patient.read", facilityId);
    if (readers.some((u) => u.id === input.userId)) {
      throw new BusinessRuleError(
        display ? "A display account must not hold patient record access" : "A kiosk account must not hold patient record access",
        display ? "display_account_too_powerful" : "kiosk_account_too_powerful",
      );
    }
    if (input.printAgentUserId) {
      if (display) throw new BusinessRuleError("A waiting-room screen has no print agent", "not_a_kiosk");
      await this.requireAgentAccount(actor, facilityId, input.printAgentUserId);
    }
    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(kioskDevice)
          .values({
            organizationId: actor.organizationId,
            facilityId,
            code: input.code,
            name: input.name,
            kind: input.kind,
            // Only a kiosk can print tickets.
            printsTickets: input.kind === "kiosk" && input.printsTickets,
            printAgentUserId: input.kind === "kiosk" ? (input.printAgentUserId ?? null) : null,
            userId: input.userId,
            createdBy: actor.userId,
          })
          .returning();
        const row = found(created, "Kiosk");
        await this.audit.record(tx, actor, {
          action: "kiosk.device.register",
          resourceType: "kiosk_device",
          resourceId: row.id,
          metadata: { code: row.code, kind: row.kind, facilityId, kioskUserId: row.userId, printsTickets: row.printsTickets },
        });
        await this.events.record(tx, {
          type: "KioskDeviceStatusChanged",
          organizationId: row.organizationId,
          aggregateType: "kiosk_device",
          aggregateId: row.id,
          facilityId,
          payload: { status: row.status },
        });
        return view(row);
      });
    } catch (error) {
      const pg = asPgError(error);
      if (pg?.code === PgErrorCode.uniqueViolation) {
        throw new ConflictError(
          pg.constraint?.includes("user_id") ? "That account is already a kiosk" : `A kiosk with the code "${input.code}" already exists at this facility`,
          undefined,
          "kiosk_exists",
        );
      }
      throw error;
    }
  }

  /** The account must hold the print agent role at this facility (and so open nothing else). */
  private async requireAgentAccount(actor: Actor, facilityId: string, userId: string): Promise<void> {
    const holders = await this.users.holdersOfRole(actor.organizationId, "kiosk_print_agent", facilityId);
    if (!holders.some((u) => u.id === userId)) {
      throw new BusinessRuleError("That account does not hold the Kiosk print agent role at this facility", "not_a_print_agent_account");
    }
  }

  async update(actor: Actor, deviceId: string, input: z.infer<typeof updateDeviceSchema>): Promise<KioskDeviceView> {
    const facilityId = requireFacilityId(actor);
    if (input.printAgentUserId) await this.requireAgentAccount(actor, facilityId, input.printAgentUserId);
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(kioskDevice)
        .where(and(eq(kioskDevice.organizationId, actor.organizationId), eq(kioskDevice.id, deviceId), eq(kioskDevice.facilityId, facilityId)))
        .for("update");
      const current = found(locked, "Kiosk");
      assertVersion(current.version, input.version, "Kiosk");
      if (input.printAgentUserId !== undefined && current.kind !== "kiosk") {
        throw new BusinessRuleError("A waiting-room screen has no print agent", "not_a_kiosk");
      }
      const [updated] = await tx
        .update(kioskDevice)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.printsTickets !== undefined && current.kind === "kiosk" ? { printsTickets: input.printsTickets } : {}),
          ...(input.printAgentUserId !== undefined ? { printAgentUserId: input.printAgentUserId } : {}),
          updatedAt: new Date(),
          version: sql`${kioskDevice.version} + 1`,
        })
        .where(eq(kioskDevice.id, deviceId))
        .returning();
      const row = found(updated, "Kiosk");
      await this.audit.record(tx, actor, {
        action: "kiosk.device.update",
        resourceType: "kiosk_device",
        resourceId: deviceId,
        changes: {
          ...(current.name !== row.name ? { name: { from: current.name, to: row.name } } : {}),
          ...(current.status !== row.status ? { status: { from: current.status, to: row.status } } : {}),
          ...(current.printsTickets !== row.printsTickets ? { printsTickets: { from: current.printsTickets, to: row.printsTickets } } : {}),
          ...(current.printAgentUserId !== row.printAgentUserId ? { printAgentUserId: { from: current.printAgentUserId, to: row.printAgentUserId } } : {}),
        },
      });
      if (current.status !== row.status) {
        await this.events.record(tx, {
          type: "KioskDeviceStatusChanged",
          organizationId: row.organizationId,
          aggregateType: "kiosk_device",
          aggregateId: row.id,
          facilityId: row.facilityId,
          payload: { status: row.status },
        });
      }
      return view(row);
    });
  }

  /**
   * The device behind the signed-in kiosk account, for this facility. A disabled kiosk is refused; one in maintenance
   * can sign in (to report itself) but serves no patients.
   */
  async requireDevice(actor: Actor, options: { serving: boolean }): Promise<KioskDeviceRecord> {
    const facilityId = requireFacilityId(actor);
    const [row] = await this.db
      .select()
      .from(kioskDevice)
      .where(and(eq(kioskDevice.organizationId, actor.organizationId), eq(kioskDevice.userId, actor.userId), eq(kioskDevice.kind, "kiosk")));
    if (!row) throw new ForbiddenError("This account is not a registered kiosk", "not_a_kiosk");
    if (row.facilityId !== facilityId) throw new ForbiddenError("This kiosk belongs to another facility", "kiosk_wrong_facility");
    if (row.status === "disabled") throw new ForbiddenError("This kiosk has been disabled", "kiosk_disabled");
    if (options.serving && row.status === "maintenance")
      throw new BusinessRuleError("This kiosk is out of service — please see the desk", "kiosk_in_maintenance");
    return row;
  }

  /** What the kiosk screen needs to start: its own name and facility (no patient data). */
  async me(actor: Actor) {
    const device = await this.requireDevice(actor, { serving: false });
    const facility = await this.organizations.getFacility(actor.organizationId, device.facilityId);
    return {
      device: { id: device.id, code: device.code, name: device.name, status: device.status },
      facility: { id: facility.id, name: facility.name, timeZone: facility.timezone },
    };
  }

  /**
   * A waiting-room display reports that it is showing (docs/domains/kiosk.md, "Devices"). An account that was never
   * registered as a display is not an error — an unregistered screen simply is not monitored. A display in maintenance or
   * disabled still shows: those states are notes for staff, not a switch.
   */
  async displayHeartbeat(actor: Actor): Promise<{ registered: boolean }> {
    const facilityId = requireFacilityId(actor);
    const updated = await this.db
      .update(kioskDevice)
      .set({ heartbeatAt: new Date() })
      .where(
        and(
          eq(kioskDevice.organizationId, actor.organizationId),
          eq(kioskDevice.facilityId, facilityId),
          eq(kioskDevice.userId, actor.userId),
          eq(kioskDevice.kind, "display"),
        ),
      )
      .returning({ id: kioskDevice.id });
    return { registered: updated.length > 0 };
  }

  async heartbeat(actor: Actor, input: z.infer<typeof heartbeatSchema>): Promise<{ status: KioskDeviceRecord["status"] }> {
    const device = await this.requireDevice(actor, { serving: false });
    await this.db
      .update(kioskDevice)
      .set({
        heartbeatAt: new Date(),
        ...(input.appVersion !== undefined ? { appVersion: input.appVersion } : {}),
      })
      .where(eq(kioskDevice.id, device.id));
    return { status: device.status };
  }
}
