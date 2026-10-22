import { ModulePage } from "@/components/module-page";
import { api } from "@/lib/api/client";
import type { StaffNotice, StaffPushStatus } from "@/lib/api/types";
import { NoticeList } from "./notice-list";
import { PushDevices } from "./push-devices";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const [notices, push] = await Promise.all([api<StaffNotice[]>("/me/notifications"), api<StaffPushStatus>("/me/push")]);
  return (
    <ModulePage
      title="Notifications"
      description="Messages the platform sent you in the app: laboratory notices, quality events and staff messages. The latest 100 are kept here."
    >
      <NoticeList notices={notices} />
      <PushDevices initial={push} />
    </ModulePage>
  );
}
