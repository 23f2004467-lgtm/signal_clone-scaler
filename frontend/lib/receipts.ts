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
  // M3 pragmatic rule: a freshly added member starts with both pointers 0
  // (their join boundary isn't tracked, §4), so they gate nothing until their
  // pointers first move — otherwise adding someone would instantly regress
  // every already-read message; their connect-time bulk advance lands at the
  // newest message, so only messages sent after they appear are ever gated.
  const others = members.filter(
    (m) =>
      m.id !== currentUserId &&
      (m.last_delivered_message_id > 0 || m.last_read_message_id > 0)
  );
  // Nobody with receipt state yet (brand-new group, no member ever connected):
  // the message is persisted but delivered to no one — stay at "sent".
  if (others.length === 0) return "sent";
  if (others.every((m) => m.last_read_message_id >= message.id)) {
    return "read";
  }
  if (others.every((m) => m.last_delivered_message_id >= message.id)) {
    return "delivered";
  }
  return "sent";
}
