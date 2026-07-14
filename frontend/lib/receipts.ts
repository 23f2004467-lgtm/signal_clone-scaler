// Tick-state derivation (blueprint §6). The server never stores a per-message
// status: receipts are the two integer pointers each member carries on the
// conversation (§4, last_delivered_message_id / last_read_message_id), and
// receipt.delivered / receipt.read events keep those pointers fresh. This is
// the client mirror of the backend's MIN()-across-members SQL: a message
// counts as delivered/read only when EVERY other member's pointer has passed
// it, so one straggler holds the whole group at the earlier state.

import type { ChatMessage, MemberInfo, MessageStatus } from "./types";

export function deriveTickStatus(
  message: ChatMessage,
  members: MemberInfo[],
  currentUserId: number
): MessageStatus {
  // "sending" and "failed" are client-only states (§6): the row has no real
  // id yet (optimistic bubbles carry id 0), so no pointer can have passed it.
  // Only an acked ("sent") message can be upgraded by the pointers.
  if (message.status !== "sent") return message.status;
  // Every OTHER member gates the message (MIN-across-members, §6): it is only
  // "read"/"delivered" once EVERY one of them has passed it. We deliberately do
  // NOT filter out members whose pointers are still 0 — a member who has never
  // connected has genuinely not received the message, so they must hold the
  // whole group at the earlier state.
  //
  // A previous version filtered on (last_delivered > 0 || last_read > 0) to keep
  // a freshly-added member from regressing old messages. But that same filter
  // also dropped never-connected ORIGINAL members from the tally: in a 3-member
  // group where only one member had read, `others` collapsed to just that reader
  // and `.every()` was vacuously satisfied — a FALSE "read" (double blue) tick.
  // That correctness bug is worse than the cosmetic regression the filter
  // prevented, so the filter is gone. (The fully correct rule would gate on a
  // join boundary — joined_at <= message.created_at — which needs joined_at
  // surfaced on MemberInfo; tracked as a follow-up.)
  const others = members.filter((m) => m.id !== currentUserId);
  // Conversation with no other members (shouldn't happen in practice): nothing
  // to gate on, so leave it at "sent".
  if (others.length === 0) return "sent";
  if (others.every((m) => m.last_read_message_id >= message.id)) {
    return "read";
  }
  if (others.every((m) => m.last_delivered_message_id >= message.id)) {
    return "delivered";
  }
  return "sent";
}
