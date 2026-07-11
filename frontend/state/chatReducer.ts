// The client's single source of UI truth (blueprint §5 + §6).
// One switch, one case per event: server WS events ARE the actions — the
// ChatProvider's onmessage dispatches each decoded frame straight in here —
// plus a few "local." actions for the things only the client knows about
// (optimistic sends, REST fetches landing, socket status).
//
// The reducer is pure: no fetches, no socket calls, no logging. Everything
// impure lives in ChatProvider.

import type {
  ChatMessage,
  ConversationSummary,
  Message,
  ServerEvent,
} from "@/lib/types";

export type SocketStatus = "connecting" | "open" | "closed";

// Someone is typing in a conversation. `at` is Date.now() when the relay
// arrived; presence of a marker means "actively typing" because the provider
// clears it 3s after the LAST relay (§5: "show typing…, clear on 3 s timeout").
export interface TypingMarker {
  user_id: number;
  at: number;
}

export interface ChatState {
  socket: SocketStatus;
  // The logged-in user's id, set once by the provider's useReducer
  // initializer. member.removed needs it to tell "someone else left" (drop
  // one member row) from "I was removed" (drop the whole conversation).
  meId: number | null;
  // The conversation open in the right pane. The reducer needs it to decide
  // whether message.new bumps a conversation's unread badge: the open one is
  // read on sight (ChatPane's read flow), so its badge must not flicker up.
  selectedId: number | null;
  conversations: ConversationSummary[] | null; // null until the first REST load
  // conversation_id -> messages, oldest first. A conversation is absent here
  // until its history is first fetched (undefined = "loading" in the UI).
  messages: { [conversationId: number]: ChatMessage[] };
  // conversation_id -> who is typing there right now (latest typist wins).
  typing: { [conversationId: number]: TypingMarker };
}

export const initialChatState: ChatState = {
  socket: "connecting", // the provider connects immediately on mount
  meId: null,
  selectedId: null,
  conversations: null,
  messages: {},
  typing: {},
};

// Client-only actions, "local."-prefixed so they can never collide with a
// server event type.
export type LocalAction =
  | { type: "local.conversations.loaded"; conversations: ConversationSummary[] }
  | { type: "local.history.loaded"; conversation_id: number; messages: Message[] }
  | { type: "local.message.sending"; message: ChatMessage }
  | { type: "local.message.retry"; conversation_id: number; client_id: string }
  | { type: "local.conversation.selected"; conversation_id: number | null }
  | { type: "local.conversation.read"; conversation_id: number }
  | { type: "local.typing.clear"; conversation_id: number }
  | { type: "local.socket.status"; status: SocketStatus };

export type ChatAction = ServerEvent | LocalAction;

// Update one conversation's preview and move it to the top — what both a
// local send and an incoming message.new do to the left pane. message.new
// for a conversation that is NOT open also counts one more unread.
function bumpConversation(
  conversations: ConversationSummary[] | null,
  message: Message,
  incrementUnread = false
): ConversationSummary[] | null {
  if (conversations === null) return null;
  const target = conversations.find((c) => c.id === message.conversation_id);
  if (!target) return conversations; // not in the list; the next refetch has it
  const updated = {
    ...target,
    last_message: message,
    unread_count: incrementUnread
      ? target.unread_count + 1
      : target.unread_count,
  };
  return [updated, ...conversations.filter((c) => c.id !== target.id)];
}

// The left pane is ordered by last activity, exactly like the backend's
// COALESCE(last_message.created_at, created_at) DESC — ISO-8601 strings
// compare correctly as plain strings, so no Date parsing is needed.
function activityStamp(c: ConversationSummary): string {
  return c.last_message?.created_at ?? c.created_at;
}

// Insert a conversation at its sorted position (newest activity first),
// replacing any existing row with the same id — conversation.created can
// arrive twice (our own POST response and the WS push) and must stay
// idempotent.
function insertSorted(
  conversations: ConversationSummary[],
  conversation: ConversationSummary
): ConversationSummary[] {
  const rest = conversations.filter((c) => c.id !== conversation.id);
  const at = rest.findIndex(
    (c) => activityStamp(c) <= activityStamp(conversation)
  );
  if (at === -1) return [...rest, conversation];
  return [...rest.slice(0, at), conversation, ...rest.slice(at)];
}

// The socket died, so no ack is coming for any in-flight send: flip every
// "sending" bubble to "failed" (tap-to-retry re-sends the same client_id).
function failPendingSends(
  messages: ChatState["messages"]
): ChatState["messages"] {
  const next: ChatState["messages"] = {};
  for (const [conversationId, list] of Object.entries(messages)) {
    next[Number(conversationId)] = list.map((m) =>
      m.status === "sending" ? { ...m, status: "failed" as const } : m
    );
  }
  return next;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    // ---- server events (blueprint §5, server -> client table) ----

    case "message.ack": {
      // Our own message came back with its real id + server timestamp. Find
      // the optimistic bubble BY client_id and update it IN PLACE — same
      // array slot, same React key — never delete-and-reinsert (§6: bubbles
      // visibly jump). sending -> sent.
      const { client_id, message } = action;
      const existing = state.messages[message.conversation_id] ?? [];
      return {
        ...state,
        messages: {
          ...state.messages,
          [message.conversation_id]: existing.map((m) =>
            m.client_id === client_id
              ? { ...message, status: "sent" as const }
              : m
          ),
        },
        conversations: bumpConversation(state.conversations, message),
      };
    }

    case "message.new": {
      // Someone else's message: append + bump that conversation's preview
      // and ordering. A conversation that is not open on screen also gains
      // one unread; the open one is covered by the read flow instead
      // (ChatPane sends "read" and local.conversation.read zeroes the badge),
      // so on-screen messages never flash a badge first.
      const { message } = action;
      const existing = state.messages[message.conversation_id];
      let messages = state.messages;
      // No history loaded yet -> nothing to append to; the REST fetch on
      // first open includes this row anyway (persist-first, §2.4). And skip
      // ids we already have — a reconnect refetch may have raced the push.
      if (existing && !existing.some((m) => m.id === message.id)) {
        messages = {
          ...state.messages,
          [message.conversation_id]: [
            ...existing,
            { ...message, status: "sent" as const },
          ],
        };
      }
      return {
        ...state,
        messages,
        conversations: bumpConversation(
          state.conversations,
          message,
          message.conversation_id !== state.selectedId
        ),
      };
    }

    case "receipt.delivered":
    case "receipt.read": {
      // One member's receipt pointer advanced (§4: the two integers on the
      // membership row ARE the receipts system). Mirror it onto that member;
      // tick states are DERIVED from the pointers at render time
      // (lib/receipts.ts), never stored per message. Math.max because
      // pointers only move forward — a live event racing the reconnect
      // refetch must never rewind one.
      if (state.conversations === null) return state;
      return {
        ...state,
        conversations: state.conversations.map((c) => {
          if (c.id !== action.conversation_id) return c;
          return {
            ...c,
            members: c.members.map((m) => {
              if (m.id !== action.user_id) return m;
              return action.type === "receipt.read"
                ? {
                    ...m,
                    last_read_message_id: Math.max(
                      m.last_read_message_id,
                      action.up_to_message_id
                    ),
                    // Reading implies delivery: the backend's read UPDATE
                    // advances BOTH pointers in one statement (queries.py,
                    // advance_member_read) but only broadcasts receipt.read —
                    // and push-time receipt.delivered goes to the sender
                    // only. Mirroring the dual advance here keeps every
                    // member's last_delivered >= last_read on every client,
                    // so the delivered check in deriveTickStatus never lags
                    // behind a read we already know about.
                    last_delivered_message_id: Math.max(
                      m.last_delivered_message_id,
                      action.up_to_message_id
                    ),
                  }
                : {
                    ...m,
                    last_delivered_message_id: Math.max(
                      m.last_delivered_message_id,
                      action.up_to_message_id
                    ),
                  };
            }),
          };
        }),
      };
    }

    case "typing":
      // The server relays another member's typing frame (never our own —
      // relays go to OTHER online members only). Date.now() is this
      // reducer's one impurity: the frame carries no timestamp. The 3s
      // expiry is driven by a provider timer dispatching local.typing.clear,
      // so rendering only ever checks marker presence.
      return {
        ...state,
        typing: {
          ...state.typing,
          [action.conversation_id]: { user_id: action.user_id, at: Date.now() },
        },
      };

    // ---- the M3 group pushes (REST handlers fan these out; the caller's
    // ---- own REST response is dispatched through the same cases) ----

    case "member.added": {
      // A group gained a member: extend that conversation's members list so
      // titles, head counts, and tick derivation see the new roster at once.
      // Replace-if-present keeps the local dispatch (the admin's REST
      // response) idempotent with the WS push echo. A conversation we don't
      // have yet is skipped — when the added member is US, the provider
      // refetches the list instead (a reducer can't fetch).
      if (state.conversations === null) return state;
      return {
        ...state,
        conversations: state.conversations.map((c) => {
          if (c.id !== action.conversation_id) return c;
          return {
            ...c,
            members: [
              ...c.members.filter((m) => m.id !== action.user.id),
              action.user,
            ],
          };
        }),
      };
    }

    case "member.removed": {
      if (state.conversations === null) return state;
      if (action.user_id === state.meId) {
        // I was removed: the conversation disappears for me entirely — drop
        // it from the list, discard its cached messages and typing marker,
        // and close it if it is the open pane (the shell falls back to the
        // placeholder). The server already refuses me on every path.
        const messages = { ...state.messages };
        delete messages[action.conversation_id];
        const typing = { ...state.typing };
        delete typing[action.conversation_id];
        return {
          ...state,
          conversations: state.conversations.filter(
            (c) => c.id !== action.conversation_id
          ),
          messages,
          typing,
          selectedId:
            state.selectedId === action.conversation_id
              ? null
              : state.selectedId,
        };
      }
      // Someone else left: shrink the members list. Tick derivation now
      // ignores their pointers, so a straggler leaving can only ever move
      // ticks FORWARD — consistent with the backend's MIN() over the
      // remaining members.
      return {
        ...state,
        conversations: state.conversations.map((c) => {
          if (c.id !== action.conversation_id) return c;
          return {
            ...c,
            members: c.members.filter((m) => m.id !== action.user_id),
          };
        }),
      };
    }

    case "conversation.updated":
      // Group rename — one field, everywhere it renders.
      if (state.conversations === null) return state;
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.conversation_id ? { ...c, name: action.name } : c
        ),
      };

    case "conversation.created":
      // A conversation now includes me: insert its full summary row at the
      // sorted position (newest activity first, matching the server's list
      // order). Before the first list load there is nothing to insert into —
      // the in-flight REST response includes the row anyway.
      if (state.conversations === null) return state;
      return {
        ...state,
        conversations: insertSorted(state.conversations, action.conversation),
      };

    case "pong":
      // Heartbeat reply — the ping exists purely to keep the pipe warm.
      return state;

    case "error":
      // Malformed-frame reports; the provider logs them. Nothing to render.
      return state;

    // ---- local actions ----

    case "local.conversations.loaded":
      return { ...state, conversations: action.conversations };

    case "local.history.loaded": {
      // REST history is the truth for persisted rows, but optimistic bubbles
      // still in flight (sending/failed) must survive the replace — e.g. a
      // reconnect refetch racing an unacked send.
      const persisted: ChatMessage[] = action.messages.map((m) => ({
        ...m,
        status: "sent" as const,
      }));
      const persistedIds = new Set(persisted.map((m) => m.client_id));
      const pending = (state.messages[action.conversation_id] ?? []).filter(
        (m) =>
          (m.status === "sending" || m.status === "failed") &&
          !persistedIds.has(m.client_id)
      );
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversation_id]: [...persisted, ...pending],
        },
      };
    }

    case "local.message.sending": {
      // The optimistic append (§6: "sending" exists only client-side).
      const { message } = action;
      const existing = state.messages[message.conversation_id] ?? [];
      return {
        ...state,
        messages: {
          ...state.messages,
          [message.conversation_id]: [...existing, message],
        },
        conversations: bumpConversation(state.conversations, message),
      };
    }

    case "local.message.retry":
      // Tap-to-retry flips failed -> sending; the provider re-sends the SAME
      // client_id, and UNIQUE(sender_id, client_id) server-side makes the
      // retry idempotent even if the original frame did land (§6).
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversation_id]: (
            state.messages[action.conversation_id] ?? []
          ).map((m) =>
            m.client_id === action.client_id
              ? { ...m, status: "sending" as const }
              : m
          ),
        },
      };

    case "local.conversation.selected":
      return { ...state, selectedId: action.conversation_id };

    case "local.conversation.read": {
      // We just told the server everything up to the newest message is read:
      // zero the badge optimistically. The next list refetch agrees, because
      // the "read" frame reached the server first (same socket, in order).
      if (state.conversations === null) return state;
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.conversation_id ? { ...c, unread_count: 0 } : c
        ),
      };
    }

    case "local.typing.clear": {
      // 3s passed since the last typing relay for this conversation.
      const typing = { ...state.typing };
      delete typing[action.conversation_id];
      return { ...state, typing };
    }

    case "local.socket.status":
      return {
        ...state,
        socket: action.status,
        // A closed socket means no pending ack can ever arrive.
        messages:
          action.status === "closed"
            ? failPendingSends(state.messages)
            : state.messages,
        // ...and no typing relay can either: stale dots must not outlive a drop.
        typing: action.status === "closed" ? {} : state.typing,
      };
  }
  // No default: every ChatAction variant returns above, so adding a new
  // event type without a case is a compile error, not a silent no-op.
}
