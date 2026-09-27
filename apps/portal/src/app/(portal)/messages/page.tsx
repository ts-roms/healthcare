import Link from "next/link";
import { ChevronRightIcon, MessageSquareIcon, PhoneIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { portalApi } from "@/lib/api/client";
import type { PortalMessage } from "@/lib/api/types";
import { messageAction, messageSource, messageTime } from "@/lib/messages";
import { MarkRead } from "./mark-read";

export const metadata = { title: "Messages" };

export default async function MessagesPage() {
  const messages = await portalApi<PortalMessage[]>("/portal/messages");
  const unread = messages.filter((m) => !m.readAt).map((m) => m.id);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Messages</h1>
        <p className="text-body text-muted-foreground">
          Notices and messages from your clinic. You cannot reply here yet: call the clinic for questions, and 911 in an emergency.
        </p>
      </div>
      {messages.length === 0 ? (
        <EmptyState icon={MessageSquareIcon} title="No messages yet">
          Booking confirmations, results notices and reminders will appear here.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {messages.map((m) => {
            const action = messageAction(m);
            return (
              <li key={m.id} className={`flex flex-col gap-1.5 rounded-xl border bg-card p-4 ${m.readAt ? "" : "border-primary/40 shadow-xs"}`}>
                <p className="flex items-baseline justify-between gap-2 text-meta text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    {m.readAt ? null : (
                      <span className="rounded-full bg-primary px-1.5 text-[0.625rem] font-semibold text-primary-foreground uppercase">New</span>
                    )}
                    {messageSource(m)}
                  </span>
                  <time dateTime={m.createdAt}>{messageTime(m.createdAt)}</time>
                </p>
                {m.subject ? <h2 className="font-semibold">{m.subject}</h2> : null}
                <p className="text-body whitespace-pre-line">{m.text}</p>
                {action ? (
                  <Link href={action.href} className="inline-flex items-center gap-1 self-start text-body font-medium text-primary hover:underline">
                    {action.label} <ChevronRightIcon className="size-4" aria-hidden />
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
        <PhoneIcon className="size-3.5" aria-hidden /> To stop reminders by SMS or email, ask the clinic to update your communication preferences.
      </p>
      <MarkRead ids={unread} />
    </div>
  );
}
