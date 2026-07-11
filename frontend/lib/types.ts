// Model types + the WebSocket event protocol (blueprint §4 + §5).
// These mirror the backend's SQLAlchemy models and the Python if/elif
// dispatch in backend/app/ws.py — one place to look when either changes.

// ---------------------------------------------------------------------------
// Model types (blueprint §4). Only the rows the API actually serializes get
// interfaces here: users and messages arrive as-is; conversations and
// memberships only ever reach the client folded into the REST response
// shapes below (ConversationSummary / MemberInfo).
// ---------------------------------------------------------------------------

export interface User {
  id: number;
  phone: string;
  username: string;
  display_name: string;
  last_seen_at: string | null; // ISO-8601; written by the server on WS disconnect
  created_at: string;
}

export type ConversationType = "direct" | "group";
export type MemberRole = "admin" | "member";

// Compact summary of the quoted message, embedded by the server wherever a
// message with reply_to_id is serialized (history rows, message.ack,
// message.new) — so the quote block renders even when the original message
// falls outside the loaded history page.
export interface ReplyToSummary {
  id: number;
  sender_id: number;
  sender_name: string; // the quoted author's display name at send time
  body_snippet: string; // first 120 chars; the quote renders one line anyway
}

export interface Message {
  id: number; // AUTOINCREMENT — defines ordering and pagination cursors
  conversation_id: number;
  sender_id: number;
  body: string;
  reply_to_id: number | null;
  reply_to: ReplyToSummary | null; // set iff reply_to_id is
  client_id: string; // the sender's crypto.randomUUID(); pairs acks with bubbles
  created_at: string; // server timestamp — never the client clock
}

// ---------------------------------------------------------------------------
// REST response shapes for GET /api/conversations (blueprint §7 — the
// left-pane query: preview, unread count, members, online flags)
// ---------------------------------------------------------------------------

// One member row as GET /api/conversations actually sends it (backend
// schemas.MemberOut): the joined user fields flattened together with the
// membership's role and receipt pointers. `id` is the user's id.
// is_online is derived server-side from the ConnectionManager dict.
export interface MemberInfo {
  id: number;
  username: string;
  display_name: string;
  role: MemberRole;
  last_delivered_message_id: number; // receipt pointer #1
  last_read_message_id: number; // receipt pointer #2
  is_online: boolean;
}

// The last-message preview embedded in each list row — backend LastMessageOut,
// a four-field subset of Message (no conversation_id/reply_to_id/client_id).
export interface LastMessagePreview {
  id: number;
  sender_id: number;
  body: string;
  created_at: string;
}

// One row of the conversation list — everything the left pane renders.
// Matches backend ConversationOut exactly; dm_key and created_by are
// server-side columns the API never sends, so they are absent here.
export interface ConversationSummary {
  id: number;
  type: ConversationType;
  name: string | null;
  created_at: string;
  members: MemberInfo[];
  last_message: LastMessagePreview | null;
  unread_count: number;
}

// ---------------------------------------------------------------------------
// Message status state machine (blueprint §6) — client-side only.
// "sending" and "failed" never exist server-side.
// ---------------------------------------------------------------------------

export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";

// A message as the client renders it: the server row plus the client-only
// status above. Optimistic bubbles are born with id 0 and the client clock;
// message.ack swaps in the real id + server timestamp IN PLACE. client_id is
// the stable identity (and React key) across that swap, so bubbles never jump.
export interface ChatMessage extends Message {
  status: MessageStatus;
}

// ---------------------------------------------------------------------------
// WS event envelope (blueprint §5). Every frame is JSON: {"type": ..., ...},
// dispatched straight into the reducer by the ChatProvider's onmessage.
// ---------------------------------------------------------------------------

// ---- Client -> Server (3 events + the infrastructure ping) ----

export interface MessageSendEvent {
  type: "message.send";
  conversation_id: number;
  client_id: string;
  body: string;
  reply_to_id?: number | null;
}

export interface TypingSendEvent {
  type: "typing";
  conversation_id: number;
}

export interface ReadSendEvent {
  type: "read";
  conversation_id: number;
  up_to_message_id: number;
}

// Heartbeat, sent every ~25s: defeats proxy idle timeouts and holds off the
// free host's spin-down while a chat tab is open. Never touches the DB.
export interface PingEvent {
  type: "ping";
}

export type ClientEvent =
  | MessageSendEvent
  | TypingSendEvent
  | ReadSendEvent
  | PingEvent;

// ---- Server -> Client (6 events + pong + the M3 group pushes) ----

export interface MessageAckEvent {
  type: "message.ack";
  client_id: string; // find the optimistic bubble by this, update it IN PLACE
  message: Message; // carries the real id + server timestamp
}

export interface MessageNewEvent {
  type: "message.new";
  message: Message;
}

export interface ReceiptDeliveredEvent {
  type: "receipt.delivered";
  conversation_id: number;
  user_id: number;
  up_to_message_id: number;
}

export interface ReceiptReadEvent {
  type: "receipt.read";
  conversation_id: number;
  user_id: number;
  up_to_message_id: number;
}

export interface TypingRelayEvent {
  type: "typing";
  conversation_id: number;
  user_id: number;
}

export interface WsErrorEvent {
  type: "error";
  code: string;
  detail: string;
}

export interface PongEvent {
  type: "pong";
}

// The four M3 events, pushed by REST handlers through the same
// ConnectionManager (same process, same dict) after their DB commit. Their
// payloads reuse the REST response shapes (MemberOut / ConversationOut), so
// the client parses one member shape and one conversation shape everywhere —
// and the REST caller's own response can be dispatched through the same
// reducer case as the push everyone else receives.

// A member joined a group (admin add). `user` carries the full membership
// row (MemberOut: role + receipt pointers, both 0 at join) — everything the
// reducer needs to extend the conversation's members list in place. The
// fan-out includes the added user themself, whose client pulls the
// conversation list (it doesn't have this conversation yet).
export interface MemberAddedEvent {
  type: "member.added";
  conversation_id: number;
  user: MemberInfo;
}

export interface MemberRemovedEvent {
  type: "member.removed";
  conversation_id: number;
  user_id: number; // when it's YOUR id, the conversation disappears for you
}

// Group renamed (PATCH /api/conversations/{id}).
export interface ConversationUpdatedEvent {
  type: "conversation.updated";
  conversation_id: number;
  name: string;
}

// A conversation now includes you: someone opened a DM with you, created a
// group with you in it, or added you to an existing group. The payload is the
// same per-recipient row GET /api/conversations returns, so the reducer can
// insert it into the left pane without a refetch.
export interface ConversationCreatedEvent {
  type: "conversation.created";
  conversation: ConversationSummary;
}

export type ServerEvent =
  | MessageAckEvent
  | MessageNewEvent
  | ReceiptDeliveredEvent
  | ReceiptReadEvent
  | TypingRelayEvent
  | WsErrorEvent
  | PongEvent
  | MemberAddedEvent
  | MemberRemovedEvent
  | ConversationUpdatedEvent
  | ConversationCreatedEvent;
