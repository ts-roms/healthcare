import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import type { StaffNotice } from "@/lib/api/types";
import { NoticeList } from "./notice-list";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const notices = await api<StaffNotice[]>("/me/notifications");
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Messages the platform sent you in the app: laboratory notices, quality events and staff messages. The latest 100 are kept here."
      />
      <NoticeList notices={notices} />
    </>
  );
}
