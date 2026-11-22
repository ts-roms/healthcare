import { redirect } from "next/navigation";
import { ASSISTANT_HOME } from "@/lib/assistant-areas";

/** The Assistant section starts on its Suggestions overview. */
export default function AssistantPage() {
  redirect(ASSISTANT_HOME);
}
