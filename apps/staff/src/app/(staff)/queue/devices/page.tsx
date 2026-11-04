import { ModulePage } from "@/components/module-page";
import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { KioskDevice, KioskPrintJob, StaffUser } from "@/lib/api/types";
import { devicesNeedingAttention } from "@/lib/kiosk-devices";
import { DeviceList } from "./device-list";
import { PrintJobs } from "./print-jobs";
import { type DeviceAccount, RegisterDevice } from "./register-device";

export const metadata = { title: "Devices" };

/**
 * The facility's patient kiosks and waiting-room screens: whether each is reporting and whether a kiosk's printer works,
 * and the kiosk tickets of the last 24 hours with a limited, audited way to print one again. Nothing here names a patient.
 */
export default async function KioskDevicesPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "kiosk.device.read")) redirect("/");
  if (!facility) {
    return (
      <ModulePage title="Devices">
        <FacilityRequired action="Kiosks and screens belong to a facility." />
      </ModulePage>
    );
  }
  const canManage = can(session, "kiosk.device.manage");
  const [{ items: devices }, { items: jobs }] = await Promise.all([
    api<{ items: KioskDevice[] }>("/kiosk/admin/devices"),
    api<{ items: KioskPrintJob[] }>("/kiosk/admin/print-jobs"),
  ]);

  // The accounts that can be registered: those holding a device role here. Listing users needs the right to read them.
  let accounts: DeviceAccount[] = [];
  if (canManage && can(session, "user.read")) {
    const users = await api<StaffUser[]>("/users").catch(() => []);
    // An account holding several device roles is offered under each of them.
    const DEVICE_ROLES = ["kiosk_device", "queue_display", "kiosk_print_agent"] as const;
    accounts = users.flatMap((u) =>
      u.membershipStatus !== "active"
        ? []
        : DEVICE_ROLES.filter((role) => u.roleAssignments.some((r) => r.roleKey === role && (r.facilityId === null || r.facilityId === facility.id))).map(
            (role) => ({
              id: u.id,
              label: `${u.displayName} (${u.email})`,
              role,
            }),
          ),
    );
  }

  const attention = devicesNeedingAttention(devices);
  return (
    <ModulePage
      title="Devices"
      description={`${facility.name} · kiosks and waiting-room screens. ${
        attention > 0 ? `${attention} need${attention === 1 ? "s" : ""} attention.` : "Nothing needs attention."
      }`}
    >
      {canManage ? <RegisterDevice accounts={accounts} /> : null}
      <DeviceList devices={devices} canManage={canManage} agents={accounts.filter((a) => a.role === "kiosk_print_agent")} />
      <h2 className="text-section font-semibold">Kiosk tickets, last 24 hours</h2>
      <PrintJobs jobs={jobs} canReprint={can(session, "kiosk.print.reprint")} />
    </ModulePage>
  );
}
