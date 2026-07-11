// Pure naming helpers shared by the left-pane list and the chat header,
// so a conversation is titled identically everywhere.

import type { ConversationSummary } from "./types";

// Groups have a name; a DM is named after the other member.
// (member.id is the user's id — see MemberInfo in types.ts.)
export function titleOf(c: ConversationSummary, currentUserId: number): string {
  if (c.type === "group") return c.name ?? "Unnamed group";
  const other = c.members.find((m) => m.id !== currentUserId);
  return other ? other.display_name : "Just you";
}

// Display name of one member — group bubbles label their sender with it.
export function memberName(c: ConversationSummary, userId: number): string {
  const member = c.members.find((m) => m.id === userId);
  return member ? member.display_name : "Unknown";
}
