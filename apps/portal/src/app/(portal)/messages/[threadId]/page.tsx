import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError } from "@healthcare/web-session";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalThreadDetail } from "@/lib/api/types";
import { NOT_FOR_EMERGENCIES, TOPIC_LABEL } from "@/lib/conversations";
import { UUID } from "@/lib/api/result";
import { messageTime } from "@/lib/messages";
import { ReplyForm } from "./reply-form";

export const metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  if (!UUID.test(threadId)) notFound();
  const { timeZone } = await getMe();
  let thread: PortalThreadDetail;
  try {
    thread = await portalApi<PortalThreadDetail>(`/portal/message-threads/${threadId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <div className="flex flex-col gap-5">
      <Link href="/messages" className="flex items-center gap-1 text-body font-medium text-primary hover:underline">
        <ChevronLeftIcon className="size-4" aria-hidden /> Messages
      </Link>
      <div>
        <p className="text-meta text-muted-foreground">{TOPIC_LABEL[thread.topic]}</p>
        <h1 className="text-page-lg font-semibold">{thread.subject}</h1>
      </div>
      <ol className="flex flex-col gap-3" aria-label="Messages in this conversation">
        {thread.messages.map((m) => (
          <li
            key={m.id}
            className={`flex max-w-[90%] flex-col gap-1 rounded-xl border p-3 ${m.sender === "patient" ? "self-end bg-primary-subtle" : "self-start bg-card"}`}
          >
            <p className="flex items-baseline justify-between gap-3 text-meta text-muted-foreground">
              <span className="font-medium">{m.sender === "patient" ? "You" : (m.senderName ?? "Your clinic")}</span>
              <time dateTime={m.createdAt}>{messageTime(m.createdAt, timeZone)}</time>
            </p>
            <p className="text-body whitespace-pre-line">{m.body}</p>
          </li>
        ))}
      </ol>
      {thread.status === "open" ? (
        <ReplyForm threadId={thread.id} />
      ) : (
        <p className="rounded-xl border bg-card p-4 text-body text-muted-foreground">
          The clinic closed this conversation.{" "}
          <Link href="/messages/new" className="font-medium text-primary hover:underline">
            Start a new message
          </Link>{" "}
          if you still need help.
        </p>
      )}
      <p className="text-meta text-muted-foreground">{NOT_FOR_EMERGENCIES}</p>
    </div>
  );
}
