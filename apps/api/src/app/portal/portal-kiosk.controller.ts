import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, ProxyAllowed, type PortalPrincipal } from "@healthcare/patient";
import { KioskDeviceService } from "../kiosk/kiosk-device.service";

/**
 * Whether the clinic has self-service kiosks in service, and where, for MyHealth to tell patients about them. Names of
 * places only — nothing about a patient, a device or a person's visit. Public to the staff guard; the patient guard
 * re-checks the session, account and portal consent.
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@ProxyAllowed()
@Controller({ path: "portal", version: "1" })
export class PortalKioskController {
  constructor(private readonly devices: KioskDeviceService) {}

  @Get("kiosk")
  @ApiOperation({ summary: "Whether kiosks are in service, and the facilities that have one (names only)" })
  async kiosk(@CurrentPatient() patient: PortalPrincipal) {
    return this.devices.inServiceLocations(patient.organizationId);
  }
}
