// Server wrapper: renders the chat bubble only when the assistant is
// switched on for this user (AI_ASSISTANT_ENABLED + optional pilot roles).

import { assistantEnabledFor } from "@/lib/ai/assistant/access";
import { AssistantBubble } from "./assistant-bubble";

export function AssistantMount({ userRoles }: { userRoles: string[] }) {
  if (!assistantEnabledFor(userRoles)) return null;
  return <AssistantBubble />;
}
