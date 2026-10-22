"use client";

import * as React from "react";
import { ConsultChat, type ConsultChatMessage } from "@healthcare/ui/healthcare";
import { listConsultationChat, sendConsultationChat } from "@/app/(staff)/telemedicine/actions";

const POLL_MS = 4_000;

/**
 * The chat of one online consultation, for the clinician: open from the waiting room until the call ends, readable
 * afterwards. Messages are read every few seconds (the API decides who may write and when); the patient's side is MyHealth.
 */
export function ConsultChatPanel({ appointmentId, canWrite }: { appointmentId: string; canWrite: boolean }) {
  const [messages, setMessages] = React.useState<ConsultChatMessage[]>([]);
  const [open, setOpen] = React.useState(false);
  const lastId = React.useRef<string | undefined>(undefined);

  const load = React.useCallback(async () => {
    const result = await listConsultationChat(appointmentId, lastId.current);
    if (!result.ok) return;
    setOpen(result.data.open);
    if (result.data.messages.length) {
      lastId.current = result.data.messages[result.data.messages.length - 1]!.id;
      setMessages((current) => [...current, ...result.data.messages.filter((m) => !current.some((c) => c.id === m.id))]);
    }
  }, [appointmentId]);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <ConsultChat
      messages={messages}
      mine="staff"
      // Reading needs only access to online consultations; writing needs to conduct them.
      open={open && canWrite}
      onSend={async (text) => {
        const result = await sendConsultationChat(appointmentId, text);
        if (!result.ok) return result.message;
        await load();
        return null;
      }}
    />
  );
}
