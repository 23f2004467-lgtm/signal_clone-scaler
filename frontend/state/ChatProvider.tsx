"use client";

// The realtime core (blueprint §2.5, §5, §6). Owns the logged-in user, the
// conversation list, per-conversation messages, and THE WebSocket — held in
// a useRef because the socket is imperative state, not render state.
// Mounted once in app/(chat)/layout.tsx, so switching conversations only
// re-renders children and never tears the socket down.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, clearSession, getStoredUser, getToken } from "@/lib/api";
import type {
  ChatMessage,
  ClientEvent,
  ReplyToSummary,
  ServerEvent,
  User,
} from "@/lib/types";
import { chatReducer, initialChatState, type ChatState } from "./chatReducer";

// NEXT_PUBLIC_* values are inlined into the bundle at build time, and only
// full literal references like these are inlined (process.env[name] is not).
// If NEXT_PUBLIC_WS_URL is unset, derive the socket URL from the API URL
// (http -> ws, https -> wss) so the two can never point at different hosts.
const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ||
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(
    /^http/,
    "ws"
  );

// Exponential backoff capped at 30s, plus jitter so all clients of a
// restarted server don't reconnect on the same tick. The loop never gives
// up: a free-host cold start takes ~30-60s and each attempt is also what
// wakes the instance (blueprint §11).
function backoffDelay(attempts: number): number {
  return Math.min(1000 * 2 ** attempts, 30000) + Math.random() * 1000;
}

// In-band heartbeat (§5): defeats NAT/proxy idle timeouts and holds off the
// free host's spin-down while a chat tab is open. The server replies "pong".
const HEARTBEAT_MS = 25000;

// A typing relay is only good for 3s (§5: "show typing…, clear on 3 s
// timeout"); every new relay for the same conversation restarts the clock.
const TYPING_CLEAR_MS = 3000;

interface ChatContextValue {
  me: User | null;
  state: ChatState;
  loadError: string | null; // conversation-list REST failure, for the sidebar
  selectedId: number | null;
  selectConversation: (id: number | null) => void;
  loadHistory: (conversationId: number) => void;
  // replyTo: the quoted message's summary, built by ChatPane from its loaded
  // history — the optimistic bubble renders the quote instantly and the
  // frame carries just reply_to_id (the server re-derives the summary).
  sendMessage: (
    conversationId: number,
    body: string,
    replyTo?: ReplyToSummary
  ) => void;
  retryMessage: (
    conversationId: number,
    clientId: string,
    body: string,
    replyToId: number | null
  ) => void;
  sendTyping: (conversationId: number) => void;
  markRead: (conversationId: number, upToMessageId: number) => void;
  // M3 (blueprint §7): create/mutate over REST, then feed the response through
  // the SAME reducer cases the server's WS pushes use — the UI is correct
  // immediately and stays idempotent when the push echo arrives.
  openDm: (peerId: number) => Promise<void>;
  createGroup: (name: string, memberIds: number[]) => Promise<void>;
  addMember: (conversationId: number, userId: number) => Promise<void>;
  removeMember: (conversationId: number, userId: number) => Promise<void>;
  renameGroup: (conversationId: number, name: string) => Promise<void>;
  logout: () => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat must be used inside <ChatProvider>");
  return value;
}

export default function ChatProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  // The (chat) layout only renders its children once a token exists, so the
  // stored user is always available by the time this initializer runs.
  const [me] = useState<User | null>(() => getStoredUser());
  // Third-argument lazy init: the reducer needs to know who "me" is so
  // member.removed can tell "someone left" from "I was removed" (M3).
  const [state, dispatch] = useReducer(
    chatReducer,
    initialChatState,
    (initial) => ({ ...initial, meId: me?.id ?? null })
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  // The selection lives in the reducer (state.selectedId) so message.new can
  // tell open from not-open when counting unread. Socket callbacks outlive
  // renders, so onopen additionally reads it from this ref rather than a
  // stale closure.
  const selectedIdRef = useRef<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  // Set before any deliberate close (logout, effect cleanup) so onclose can
  // tell "we hung up" from "the connection dropped" — without it, logout
  // would schedule a reconnect and loop forever.
  const closedOnPurposeRef = useRef(false);

  const selectConversation = useCallback((id: number | null) => {
    selectedIdRef.current = id;
    dispatch({ type: "local.conversation.selected", conversation_id: id });
  }, []);

  // A 401 means the session row is gone — the ephemeral backend DB reseeds
  // on every cold start, so stale tokens are a normal, expected event.
  const kickToLogin = useCallback(() => {
    clearSession();
    router.replace("/login");
  }, [router]);

  // Both loaders update state only from promise callbacks (never
  // synchronously inside an effect body), per the react-hooks lint rules.
  const loadConversations = useCallback(() => {
    api
      .listConversations()
      .then((conversations) => {
        dispatch({ type: "local.conversations.loaded", conversations });
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          kickToLogin();
          return;
        }
        setLoadError(
          err instanceof Error ? err.message : "Failed to load chats"
        );
      });
  }, [kickToLogin]);

  const loadHistory = useCallback(
    (conversationId: number) => {
      api
        .listMessages(conversationId)
        .then((messages) => {
          dispatch({
            type: "local.history.loaded",
            conversation_id: conversationId,
            messages,
          });
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 401) kickToLogin();
          // other failures: keep what's on screen; reconnect refetches
        });
    },
    [kickToLogin]
  );

  // First paint: fetch the list over REST immediately instead of waiting for
  // the socket handshake (REST still works while the socket is down).
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // The socket lifecycle — connect on mount (i.e. on login), clean up on
  // unmount (logout or leaving the chat shell). Everything lives in this one
  // effect closure so there is exactly one place to read it.
  useEffect(() => {
    closedOnPurposeRef.current = false;
    // Per-run flag flipped by THIS run's cleanup. StrictMode in dev mounts,
    // unmounts, and remounts: the first run's socket may fire onclose after
    // the second run has already reset closedOnPurposeRef, and this local
    // flag is what stops that stale handler from scheduling a reconnect.
    let disposed = false;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    // conversation_id -> pending local.typing.clear timer. Scoped to this
    // effect run so cleanup can never leak a dispatch into an unmounted tree.
    const typingClearTimers = new Map<number, number>();
    let attempts = 0;

    function connect() {
      if (disposed || closedOnPurposeRef.current) return;
      const token = getToken();
      if (!token) return;
      dispatch({ type: "local.socket.status", status: "connecting" });

      // Auth rides the URL (§2.1): the browser WebSocket API cannot set an
      // Authorization header, so the session token goes in the query string.
      const ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(token)}`);
      socketRef.current = ws;

      ws.onopen = () => {
        attempts = 0;
        dispatch({ type: "local.socket.status", status: "open" });
        // The offline catch-up path (§2.4): everything missed while
        // disconnected is already in the DB, so "sync" is just refetching
        // the list and the open conversation's history over REST.
        loadConversations();
        if (selectedIdRef.current !== null) loadHistory(selectedIdRef.current);
        heartbeatTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const ping: ClientEvent = { type: "ping" };
            ws.send(JSON.stringify(ping));
          }
        }, HEARTBEAT_MS);
      };

      ws.onmessage = (e: MessageEvent) => {
        let event: ServerEvent;
        try {
          event = JSON.parse(e.data) as ServerEvent;
        } catch {
          return; // not JSON — nothing the reducer could do with it
        }
        if (event.type === "error") {
          console.warn("ws error event:", event.code, event.detail);
        }
        if (
          event.type === "member.removed" &&
          me !== null &&
          event.user_id === me.id &&
          selectedIdRef.current === event.conversation_id
        ) {
          // I was removed from the OPEN conversation: the reducer clears
          // state.selectedId, but this ref (read by the onopen refetch) lives
          // outside the reducer and must be cleared by hand.
          selectedIdRef.current = null;
        }
        if (
          event.type === "member.added" &&
          me !== null &&
          event.user.id === me.id
        ) {
          // I was added to a group I don't have yet: the event alone can't
          // build the left-pane row (preview, unread count, full roster), so
          // pull the list — the same catch-up the socket's onopen does.
          loadConversations();
        }
        if (event.type === "typing") {
          // The reducer only stores the marker; (re)arm the 3s clear here so
          // the dots vanish 3s after the LAST relay, not the first.
          const cid = event.conversation_id;
          window.clearTimeout(typingClearTimers.get(cid));
          typingClearTimers.set(
            cid,
            window.setTimeout(() => {
              typingClearTimers.delete(cid);
              dispatch({ type: "local.typing.clear", conversation_id: cid });
            }, TYPING_CLEAR_MS)
          );
        }
        dispatch(event); // server events ARE reducer actions (§5)
      };

      ws.onclose = () => {
        window.clearInterval(heartbeatTimer);
        // Only clear the ref if it still points at THIS socket — in dev,
        // StrictMode's unmount/remount means the first run's socket closes
        // AFTER the second run has already stored its replacement, and a
        // stale handler must never clobber the live socket.
        if (socketRef.current === ws) socketRef.current = null;
        if (disposed || closedOnPurposeRef.current) return; // deliberate close
        // A real drop: flip in-flight "sending" bubbles to "failed" (no ack
        // can arrive on a dead socket) and start the backoff loop.
        dispatch({ type: "local.socket.status", status: "closed" });
        reconnectTimer = window.setTimeout(connect, backoffDelay(attempts));
        attempts += 1;
      };
      // No onerror handler: a failed connection always fires onclose too, so
      // the reconnect logic lives in exactly one place.
    }

    connect();

    return () => {
      // Mark the close deliberate BEFORE closing, so onclose (which fires
      // asynchronously) never schedules a reconnect for an unmounted tree.
      disposed = true;
      closedOnPurposeRef.current = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(heartbeatTimer);
      for (const timer of typingClearTimers.values()) {
        window.clearTimeout(timer);
      }
      typingClearTimers.clear();
      socketRef.current?.close();
      socketRef.current = null;
    };
    // `me` is set once at mount and never changes; it is listed only to keep
    // the dependency list honest.
  }, [loadConversations, loadHistory, me]);

  const sendMessage = useCallback(
    (conversationId: number, body: string, replyTo?: ReplyToSummary) => {
      const ws = socketRef.current;
      // The Composer is disabled while the socket isn't OPEN, so this guard
      // only catches the race where it closed mid-keystroke.
      if (!me || !ws || ws.readyState !== WebSocket.OPEN) return;
      const client_id = crypto.randomUUID();
      // Optimistic bubble (§6): "sending" exists only client-side. id 0 and
      // the client clock are placeholders; message.ack replaces both in
      // place with the real row (including the server-derived reply_to).
      const optimistic: ChatMessage = {
        id: 0,
        conversation_id: conversationId,
        sender_id: me.id,
        body,
        reply_to_id: replyTo?.id ?? null,
        reply_to: replyTo ?? null,
        client_id,
        created_at: new Date().toISOString(),
        status: "sending",
      };
      dispatch({ type: "local.message.sending", message: optimistic });
      const frame: ClientEvent = {
        type: "message.send",
        conversation_id: conversationId,
        client_id,
        body,
        reply_to_id: replyTo?.id,
      };
      ws.send(JSON.stringify(frame));
    },
    [me]
  );

  const retryMessage = useCallback(
    (
      conversationId: number,
      clientId: string,
      body: string,
      replyToId: number | null
    ) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return; // still offline: stay failed
      dispatch({
        type: "local.message.retry",
        conversation_id: conversationId,
        client_id: clientId,
      });
      // The SAME client_id (§6): if the original frame did reach the server
      // before the drop, UNIQUE(sender_id, client_id) makes this retry
      // idempotent and the ack still reconciles the one bubble. The same
      // reply_to_id rides along so a retried reply stays a reply.
      const frame: ClientEvent = {
        type: "message.send",
        conversation_id: conversationId,
        client_id: clientId,
        body,
        reply_to_id: replyToId ?? undefined,
      };
      ws.send(JSON.stringify(frame));
    },
    []
  );

  // Typing frames are fire-and-forget UI sugar (§5: pure relay, never
  // persisted), so a down socket just means silence — never an error.
  const sendTyping = useCallback((conversationId: number) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const frame: ClientEvent = {
      type: "typing",
      conversation_id: conversationId,
    };
    ws.send(JSON.stringify(frame));
  }, []);

  // The delivered→read transition's one writer is this client (§6): tell the
  // server how far we've read, and zero the local badge only when the frame
  // was actually sent — if the socket is down the server still counts those
  // messages as unread, and so must we (truth returns on the next refetch).
  const markRead = useCallback(
    (conversationId: number, upToMessageId: number) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const frame: ClientEvent = {
        type: "read",
        conversation_id: conversationId,
        up_to_message_id: upToMessageId,
      };
      ws.send(JSON.stringify(frame));
      dispatch({
        type: "local.conversation.read",
        conversation_id: conversationId,
      });
    },
    []
  );

  // ---- M3 group/DM actions --------------------------------------------
  // Each one is REST-then-dispatch: the server commits first (it is the
  // source of truth), and the response — the same shape as the WS push the
  // other members receive — goes through the same reducer case, so the
  // caller's UI updates without waiting for (or depending on) its own echo.
  // 401s kick to login like every other REST call; other failures are
  // rethrown so the calling screen can decide what to show.

  const failUnlessAuth = useCallback(
    (err: unknown): never => {
      if (err instanceof ApiError && err.status === 401) kickToLogin();
      throw err;
    },
    [kickToLogin]
  );

  const openDm = useCallback(
    async (peerId: number) => {
      try {
        // The server dedupes on dm_key, so "create" may return the DM that
        // already existed — either way the row is inserted-or-replaced and
        // opened.
        const conversation = await api.createDm(peerId);
        dispatch({ type: "conversation.created", conversation });
        selectConversation(conversation.id);
      } catch (err) {
        failUnlessAuth(err);
      }
    },
    [selectConversation, failUnlessAuth]
  );

  const createGroup = useCallback(
    async (name: string, memberIds: number[]) => {
      try {
        const conversation = await api.createGroup(name, memberIds);
        dispatch({ type: "conversation.created", conversation });
        selectConversation(conversation.id);
      } catch (err) {
        failUnlessAuth(err);
      }
    },
    [selectConversation, failUnlessAuth]
  );

  const addMember = useCallback(
    async (conversationId: number, userId: number) => {
      try {
        const member = await api.addMember(conversationId, userId);
        dispatch({
          type: "member.added",
          conversation_id: conversationId,
          user: member,
        });
      } catch (err) {
        failUnlessAuth(err);
      }
    },
    [failUnlessAuth]
  );

  const removeMember = useCallback(
    async (conversationId: number, userId: number) => {
      try {
        await api.removeMember(conversationId, userId);
        dispatch({
          type: "member.removed",
          conversation_id: conversationId,
          user_id: userId,
        });
      } catch (err) {
        failUnlessAuth(err);
      }
    },
    [failUnlessAuth]
  );

  const renameGroup = useCallback(
    async (conversationId: number, name: string) => {
      try {
        const renamed = await api.renameGroup(conversationId, name);
        dispatch({
          type: "conversation.updated",
          conversation_id: conversationId,
          name: renamed.name,
        });
      } catch (err) {
        failUnlessAuth(err);
      }
    },
    [failUnlessAuth]
  );

  const logout = useCallback(async () => {
    closedOnPurposeRef.current = true; // silence the reconnect loop first
    socketRef.current?.close();
    try {
      await api.logout();
    } catch {
      // the session row may already be gone server-side; sign out locally
    }
    clearSession();
    router.replace("/login");
  }, [router]);

  const value: ChatContextValue = {
    me,
    state,
    loadError,
    selectedId: state.selectedId,
    selectConversation,
    loadHistory,
    sendMessage,
    retryMessage,
    sendTyping,
    markRead,
    openDm,
    createGroup,
    addMember,
    removeMember,
    renameGroup,
    logout,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
