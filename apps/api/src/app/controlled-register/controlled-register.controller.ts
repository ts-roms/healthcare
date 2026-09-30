import { Controller, Get, Query, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { UsersService } from "@healthcare/auth";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions, toCsv } from "@healthcare/core";
import { ControlledRegisterQueryDto, InventoryComplianceService } from "@healthcare/inventory";

const KIND_LABEL: Record<string, string> = {
  receipt: "Received",
  issue: "Issued",
  transfer_out: "Transferred out",
  transfer_in: "Transferred in",
  adjustment: "Count adjustment",
  write_off: "Written off",
  return: "Returned",
};

/**
 * The register of controlled items (docs/architecture/compliance-configuration.md): read from the stock ledger by the
 * inventory library, with the names of the staff who recorded each movement added here. The platform's layout — not a
 * form prescribed by the Dangerous Drugs Board or FDA (compliance dependency): the organization validates whether it
 * serves as its register.
 */
@ApiTags("inventory compliance")
@ApiBearerAuth()
@Controller({ path: "inventory", version: "1" })
export class ControlledRegisterController {
  constructor(
    private readonly compliance: InventoryComplianceService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get("controlled-register")
  @RequireFacility()
  @RequirePermissions("inventory.controlled-register.read")
  @ApiOperation({ summary: "Movements of controlled items at the selected facility over a period, with opening, running and closing balances (audited)" })
  async register(@CurrentActor() actor: Actor, @Query() query: ControlledRegisterQueryDto) {
    const register = await this.withNames(actor, query);
    await this.audit.recordStandalone(actor, {
      action: "inventory.controlled-register.view",
      resourceType: "facility",
      resourceId: register.facility.id,
      metadata: { from: query.from, to: query.to, itemId: query.itemId ?? null, locationId: query.locationId ?? null, sections: register.sections.length },
    });
    return register;
  }

  @Get("controlled-register/export")
  @RequireFacility()
  @RequirePermissions("inventory.controlled-register.read")
  @ApiOperation({ summary: "The register as CSV (one row per movement, with opening and closing rows per item and location; audited)" })
  async export(@CurrentActor() actor: Actor, @Query() query: ControlledRegisterQueryDto): Promise<StreamableFile> {
    const register = await this.withNames(actor, query);
    const rows: Array<Array<string | number | null>> = [
      ["Facility", register.facility.name],
      ["Licence reference (as recorded)", register.setting.licenceReference],
      ["Responsible person (as recorded)", register.setting.responsiblePerson],
      ["Period", `${query.from} to ${query.to}`],
      [],
      [
        "Item code",
        "Item",
        "Unit",
        "Location",
        "Recorded at",
        "Movement",
        "Quantity",
        "Balance",
        "Lot",
        "Expiry",
        "Reference",
        "Issued to",
        "Reason",
        "Recorded by",
      ],
    ];
    for (const s of register.sections) {
      rows.push([
        s.item.code,
        s.item.name,
        s.item.stockUnit,
        s.location.name,
        null,
        "Balance before the period",
        null,
        s.opening,
        null,
        null,
        null,
        null,
        null,
        null,
      ]);
      for (const l of s.lines) {
        rows.push([
          s.item.code,
          s.item.name,
          s.item.stockUnit,
          s.location.name,
          l.recordedAt,
          KIND_LABEL[l.kind] ?? l.kind,
          l.quantity,
          l.balance,
          l.lotNumber,
          l.expiryDate,
          l.reference,
          l.issuedTo,
          l.reason,
          l.recordedByName,
        ]);
      }
      rows.push([
        s.item.code,
        s.item.name,
        s.item.stockUnit,
        s.location.name,
        null,
        "Balance at the end of the period",
        null,
        s.closing,
        null,
        null,
        null,
        null,
        null,
        null,
      ]);
    }
    await this.audit.recordStandalone(actor, {
      action: "inventory.controlled-register.export",
      resourceType: "facility",
      resourceId: register.facility.id,
      metadata: { from: query.from, to: query.to, itemId: query.itemId ?? null, locationId: query.locationId ?? null, sections: register.sections.length },
    });
    const body = Buffer.from(`\uFEFF${toCsv(rows)}`, "utf8");
    const filename = `controlled-register-${query.from}-to-${query.to}.csv`;
    return new StreamableFile(body, { type: "text/csv; charset=utf-8", disposition: `attachment; filename="${filename}"`, length: body.length });
  }

  private async withNames(actor: Actor, query: ControlledRegisterQueryDto) {
    const register = await this.compliance.controlledRegister(actor, query);
    const names = await this.users.displayNames(actor.organizationId, [...new Set(register.sections.flatMap((s) => s.lines.map((l) => l.recordedBy)))]);
    return {
      ...register,
      sections: register.sections.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, recordedByName: names.get(l.recordedBy) ?? null })) })),
    };
  }
}
