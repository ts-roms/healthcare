import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { NewConversationForm } from "./new-conversation-form";

export const metadata = { title: "New message" };

export default function NewMessagePage() {
  return (
    <div className="flex flex-col gap-5">
      <Link href="/messages" className="flex items-center gap-1 text-body font-medium text-primary hover:underline">
        <ChevronLeftIcon className="size-4" aria-hidden /> Messages
      </Link>
      <h1 className="text-page-lg font-semibold">New message to the clinic</h1>
      <NewConversationForm />
    </div>
  );
}
