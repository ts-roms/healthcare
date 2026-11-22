import { redirect } from "next/navigation";
import { can, getSession } from "@/lib/api/session";
import { ASSISTANT_HOME } from "@/lib/assistant-areas";
import { ASK_HOME } from "@/lib/assistant-ask";

/** The Assistant section starts on Ask for those who may ask, else on its Suggestions overview. */
export default async function AssistantPage() {
  const session = await getSession();
  redirect(can(session, "assistant.ask") ? ASK_HOME : ASSISTANT_HOME);
}
