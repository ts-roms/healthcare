import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { PatientMessageSetting, StaffRoleDefinition, StaffUser } from "@/lib/api/types";
import { MessageSettings } from "./message-settings";

export const metadata = { title: "Message routing" };

/**
 * Where each topic's MyHealth conversations go at the selected facility and how soon the clinic means to answer
 * (migration 0097). Reading needs `patient.message.read`; saving `clinic.configure`. Roles and people to route to are
 * listed when the user may read the staff directory; otherwise a role key is typed.
 */
export default async function MessageSettingsPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "patient.message.read")) redirect("/");
  const directory = can(session, "user.read");
  const [settings, roles, users] = await Promise.all([
    facility
      ? api<PatientMessageSetting[]>("/patient-messages/settings", { query: { facilityId: facility.id } })
      : Promise.resolve([] as PatientMessageSetting[]),
    directory ? api<StaffRoleDefinition[]>("/roles") : Promise.resolve([] as StaffRoleDefinition[]),
    directory ? api<StaffUser[]>("/users") : Promise.resolve([] as StaffUser[]),
  ]);
  return (
    <>
      <PageHeader
        title="Message routing and response targets"
        description="For each topic a patient can write about: who is told of a new message (a role, one person, or everyone who can reply here), whether it is assigned on arrival, and by how many hours the clinic means to answer. Past the target, the conversation is marked and the responsible people get one reminder."
      />
      {facility ? (
        <MessageSettings
          facilityId={facility.id}
          facilityName={facility.name}
          settings={settings}
          roles={roles.map((r) => ({ key: r.key, name: r.name }))}
          users={users.filter((u) => u.membershipStatus === "active").map((u) => ({ id: u.id, displayName: u.displayName }))}
          directory={directory}
          canConfigure={can(session, "clinic.configure")}
        />
      ) : (
        <p className="px-4 pb-4 text-table text-muted-foreground">Select a facility in the top bar to set message routing.</p>
      )}
    </>
  );
}
