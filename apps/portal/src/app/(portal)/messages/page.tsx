import Link from "next/link";
import { ChevronRightIcon, MessageSquareIcon, PhoneIcon, PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalMessage, PortalThread } from "@/lib/api/types";
import { NOT_FOR_EMERGENCIES, threadState, TOPIC_LABEL } from "@/lib/conversations";
import { messageAction, messageSource, messageTime } from "@/lib/messages";
import { MarkRead } from "./mark-read";

export const metadata = { title: "Messages" };

export default async function MessagesPage() {
  // Dates and times are shown in the patient\'s clinic\'s time zone.
  const { timeZone } = await getMe();
  const [messages, threads] = await Promise.all([portalApi<PortalMessage[]>("/portal/messages"), portalApi<PortalThread[]>("/portal/message-threads")]);
  const unread = messages.filter((m) => !m.readAt).map((m) => m.id);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Messages</h1>
        <p className="text-body text-muted-foreground">Write to your clinic, and read its notices.</p>
      </div>
      <section aria-labelledby="conversations-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="conversations-heading" className="font-semibold">
            Your conversations
          </h2>
          <Link href="/messages/new" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-body font-medium text-primary-foreground">
            <PlusIcon className="size-4" aria-hidden /> New message
          </Link>
        </div>
        <p className="flex items-start gap-1.5 text-meta text-muted-foreground">
          <PhoneIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {NOT_FOR_EMERGENCIES}
        </p>
        {threads.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-4 text-body text-muted-foreground">
            No conversations yet. Choose <strong>New message</strong> to ask the clinic a question.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {threads.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/messages/${t.id}`}
                  className={`flex items-center gap-3 rounded-xl border bg-card p-4 ${t.unread ? "border-primary/40 shadow-xs" : ""}`}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5 truncate font-semibold">
                      {t.unread ? <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden /> : null}
                      {t.subject}
                    </span>
                    <span className="text-meta text-muted-foreground">
                      {TOPIC_LABEL[t.topic]} · {threadState(t)} · <time dateTime={t.lastMessageAt}>{messageTime(t.lastMessageAt, timeZone)}</time>
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <h2 className="font-semibold">Notices</h2>
      {messages.length === 0 ? (
        <EmptyState icon={MessageSquareIcon} title="No notices yet">
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
                  <time dateTime={m.createdAt}>{messageTime(m.createdAt, timeZone)}</time>
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
        <PhoneIcon className="size-3.5" aria-hidden /> To stop reminders by SMS or email, change your{" "}
        <Link href="/notification-settings" className="font-medium text-primary hover:underline">
          notification settings
        </Link>
        .
      </p>
      <MarkRead ids={unread} />
    </div>
  );
}
