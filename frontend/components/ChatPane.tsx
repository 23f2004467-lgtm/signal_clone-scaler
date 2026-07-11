"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Avatar from "./Avatar";
import Composer from "./Composer";
import DayDivider from "./DayDivider";
import EmptyState from "./EmptyState";
import MessageBubble, { type QuoteInfo } from "./MessageBubble";
import Toast, { type ToastData } from "./Toast";
import TypingIndicator from "./TypingIndicator";
import { memberName, titleOf } from "@/lib/conversation";
import { deriveTickStatus } from "@/lib/receipts";
import type { ChatMessage, ConversationSummary, User } from "@/lib/types";
import { useChat } from "@/state/ChatProvider";
import { dayLabel, isSameDay } from "./timeFormat";
import styles from "./ChatPane.module.css";

// The right pane (DESIGN.md §3.4–§3.9, §3.19): 52px header (avatar, name,
// presence subtitle, inert call/search buttons, kebab), the scrolling
// timeline (E2EE notice, day-divider chips, 3-minute run grouping, typing
// bubble, scroll-to-bottom pill), and the composer. History loads over REST
// when the selection changes; live messages arrive through the reducer —
// this component only renders state.

// Verified grouping window (ts/util/timelineUtil.std.ts).
const COLLAPSE_WITHIN_MS = 3 * 60 * 1000;

// Messages collapse into a run when same author AND <3 minutes apart AND the
// same calendar day (§3.6; the clone renders no reactions or unread divider,
// so those run-breakers never fire).
function sameRun(older: ChatMessage, newer: ChatMessage): boolean {
  return (
    older.sender_id === newer.sender_id &&
    isSameDay(older.created_at, newer.created_at) &&
    Math.abs(
      new Date(newer.created_at).getTime() -
        new Date(older.created_at).getTime()
    ) < COLLAPSE_WITHIN_MS
  );
}

// Auto-scroll only when the reader is already near the bottom (§4 [approx]).
const NEAR_BOTTOM_PX = 100;
// The scroll-to-bottom pill appears past this distance (§4 [approx]).
const SHOW_PILL_PX = 300;

// ---- 20px header/composer glyphs (1.5 stroke, round caps — §3.4) ----------

const iconVideo = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect
      x="2.75"
      y="5.25"
      width="10"
      height="9.5"
      rx="2.25"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="m13 8.6 3.6-2.3a.6.6 0 0 1 .9.5v6.4a.6.6 0 0 1-.9.5L13 11.4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const iconPhone = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M4.1 3.5 6 3.15c.4-.07.8.14.97.5l1.1 2.46c.14.3.07.67-.16.9L6.55 8.36a10.6 10.6 0 0 0 5.1 5.1l1.34-1.36c.24-.24.6-.3.9-.17l2.47 1.1c.36.17.57.57.5.97l-.35 1.9c-.08.47-.5.82-.98.8C9.13 16.4 3.6 10.87 3.3 4.48a.94.94 0 0 1 .8-.98Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const iconSearch = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="9" cy="9" r="5.25" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="m13.1 13.1 3.4 3.4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const iconKebab = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="10" cy="10" r="1.5" />
    <circle cx="10" cy="15.5" r="1.5" />
  </svg>
);

const iconChevronLeft = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M12.5 4.5 6.75 10l5.75 5.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const iconChevronDown = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="m5 7.75 5 5 5-5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const iconLock = (
  <svg
    className={styles.encLockGlyph}
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <rect
      x="3.4"
      y="7.1"
      width="9.2"
      height="6.3"
      rx="1.6"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <path
      d="M5.6 7.1V5.2a2.4 2.4 0 0 1 4.8 0v1.9"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

// ---------------------------------------------------------------------------

interface Props {
  // null -> no chat selected: the pane renders the §3.12 EmptyState
  // (desktop/tablet; on ≤640px the page's single-pane grid shows the list).
  conversation: ConversationSummary | null;
  me: User;
  // Group conversations only (M3): opens the GroupInfoPanel (kebab + the
  // header identity block, like clicking a group header in Signal).
  onShowInfo?: () => void;
  // ≤640px single-pane layout: the back chevron clears the selection.
  onBack?: () => void;
}

export default function ChatPane({ conversation, me, onShowInfo, onBack }: Props) {
  if (!conversation) return <EmptyState />;
  return (
    <ChatPaneInner
      conversation={conversation}
      me={me}
      onShowInfo={onShowInfo}
      onBack={onBack}
    />
  );
}

function ChatPaneInner({
  conversation,
  me,
  onShowInfo,
  onBack,
}: Props & { conversation: ConversationSummary }) {
  const {
    state,
    loadHistory,
    sendMessage,
    retryMessage,
    sendTyping,
    markRead,
  } = useChat();
  const messages = state.messages[conversation.id]; // undefined until loaded
  // Present only while someone is actively typing here — the provider clears
  // the marker 3s after their last typing relay.
  const typingMarker = state.typing[conversation.id];

  // Load history on conversation select. loadHistory is a stable useCallback,
  // so this runs once per selected conversation (twice in dev StrictMode —
  // harmless, the reducer replaces rather than appends).
  useEffect(() => {
    loadHistory(conversation.id);
  }, [conversation.id, loadHistory]);

  // Relative timestamps ("Now", "5m") go stale by the minute — a slow tick
  // re-renders the timeline so labels advance. Purely visual.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setClockTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // ---- Scroll management (§4): pin to bottom only when the reader is
  // already near it; otherwise count arrivals into the pill badge. ----------
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const [pillVisible, setPillVisible] = useState(false);
  const [pillCount, setPillCount] = useState(0);

  // §3.14 toast for every mocked control (video/phone/search/kebab, plus the
  // composer's emoji/mic/attach). Bumping the id replaces the current toast
  // and restarts its 3s clock — one at a time, per spec.
  const [toast, setToast] = useState<ToastData | null>(null);
  function comingSoon() {
    setToast((t) => ({ id: (t?.id ?? 0) + 1, text: "Coming Soon" }));
  }

  function scrollToBottom(smooth: boolean) {
    const el = scrollRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth && !reduceMotion ? "smooth" : "auto",
    });
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = dist < NEAR_BOTTOM_PX;
    setPillVisible(dist > SHOW_PILL_PX);
    if (dist < NEAR_BOTTOM_PX) setPillCount(0);
  }

  // History load -> jump straight to the newest message. New message -> pin
  // to bottom when it's ours or the reader is near the bottom; otherwise
  // bump the pill's unread count. Receipt/ack updates keep the length, so
  // they never move the scroll. (Layout effect: the initial jump must land
  // before paint or the timeline flashes at the top.)
  const prevCountRef = useRef(-1);
  const msgCount = messages?.length ?? 0;
  const lastMessage = msgCount > 0 ? messages![msgCount - 1] : undefined;
  const lastIsOwn = lastMessage?.sender_id === me.id;
  useLayoutEffect(() => {
    if (messages === undefined) return;
    const prev = prevCountRef.current;
    prevCountRef.current = msgCount;
    const el = scrollRef.current;
    if (!el) return;
    if (prev === -1) {
      el.scrollTop = el.scrollHeight; // initial render: instant
      return;
    }
    if (msgCount > prev) {
      if (lastIsOwn || nearBottomRef.current) {
        scrollToBottom(true);
      } else {
        setPillCount((c) => c + (msgCount - prev));
      }
    }
  }, [messages, msgCount, lastIsOwn]);

  // The typing bubble appearing/disappearing keeps the bottom pinned only
  // when the reader is already there (§3.9).
  useEffect(() => {
    if (typingMarker && nearBottomRef.current) scrollToBottom(true);
  }, [typingMarker]);

  // The read flow (§6: delivered→read has exactly one writer — this client).
  // Report how far we've read whenever there is something new AND the user
  // can actually see it: tab visible and window focused. Runs on open, when
  // a new message lands while open, after a reconnect, and on refocus (the
  // two listeners). The newest persisted id comes from loaded history,
  // falling back to the list preview so an unread badge clears even before
  // history finishes loading; optimistic bubbles (id 0) never win the max.
  const latestMessageId = (messages ?? []).reduce(
    (max, m) => Math.max(max, m.id),
    conversation.last_message?.id ?? 0
  );
  const socketOpen = state.socket === "open";
  // Each id is reported once per mount (ChatPane remounts per conversation,
  // so switching back re-reports once — harmless, the pointer is monotonic
  // server-side).
  const lastReadSentRef = useRef(0);
  useEffect(() => {
    function maybeMarkRead() {
      if (latestMessageId <= lastReadSentRef.current) return;
      if (!socketOpen) return;
      if (document.visibilityState !== "visible" || !document.hasFocus()) {
        return;
      }
      lastReadSentRef.current = latestMessageId;
      markRead(conversation.id, latestMessageId);
    }
    maybeMarkRead();
    window.addEventListener("focus", maybeMarkRead);
    document.addEventListener("visibilitychange", maybeMarkRead);
    return () => {
      window.removeEventListener("focus", maybeMarkRead);
      document.removeEventListener("visibilitychange", maybeMarkRead);
    };
  }, [conversation.id, latestMessageId, socketOpen, markRead]);

  const title = titleOf(conversation, me.id);
  const isGroup = conversation.type === "group";
  // DM presence comes from the other member's is_online flag (derived
  // server-side from the ConnectionManager dict). Groups show a head count.
  // MemberInfo carries no last_seen_at, so offline DMs read `offline`.
  const other = !isGroup
    ? conversation.members.find((m) => m.id !== me.id)
    : undefined;
  const typistName = typingMarker
    ? memberName(conversation, typingMarker.user_id)
    : null;
  const subtitle = !isGroup
    ? typingMarker
      ? "typing…"
      : other?.is_online
        ? "online"
        : "offline"
    : typistName
      ? `${typistName} is typing…`
      : `${conversation.members.length} members`;

  // The header's identity block. For groups it becomes a real <button> that
  // opens the info panel (like clicking a group header in Signal); DMs keep
  // the plain block.
  // §3.3 color-hash keys: user id for people, conversation id for groups —
  // the same convention the list and modals use, so colors match everywhere.
  const headerHashKey = isGroup
    ? String(conversation.id)
    : other
      ? String(other.id)
      : undefined;

  const headerIdentity = (
    <>
      <span className={styles.headerAvatar}>
        <Avatar name={title} size={32} hashKey={headerHashKey} />
      </span>
      <span className={styles.headerText}>
        <span className={styles.headerName}>{title}</span>
        <span className={styles.headerSub}>{subtitle}</span>
      </span>
    </>
  );

  // ---- Timeline items: day-divider chips (§3.5) + grouped bubbles (§3.6),
  // with reply quotes resolved from the loaded history (§3.7). -------------
  const messageById = new Map<number, ChatMessage>();
  for (const m of messages ?? []) if (m.id > 0) messageById.set(m.id, m);

  const timeline: ReactNode[] = [];
  (messages ?? []).forEach((m, i) => {
    const prev = i > 0 ? messages![i - 1] : undefined;
    const next = i < messages!.length - 1 ? messages![i + 1] : undefined;

    if (!prev || !isSameDay(prev.created_at, m.created_at)) {
      timeline.push(
        <li className={styles.dividerItem} key={`day-${m.client_id}`}>
          <DayDivider label={dayLabel(m.created_at)} />
        </li>
      );
    }

    const own = m.sender_id === me.id;
    const collapseAbove = !!prev && sameRun(prev, m);
    const collapseBelow = !!next && sameRun(m, next);

    const quoted = m.reply_to_id ? messageById.get(m.reply_to_id) : undefined;
    const quote: QuoteInfo | undefined = quoted
      ? {
          label:
            quoted.sender_id === me.id
              ? "You"
              : memberName(conversation, quoted.sender_id),
          hashKey: String(quoted.sender_id),
          ownQuoted: quoted.sender_id === me.id,
          text: quoted.body,
        }
      : undefined;

    timeline.push(
      <MessageBubble
        // client_id, not id: it is stable across the ack swapping
        // id 0 for the real id, so React keeps the same DOM node.
        key={m.client_id}
        message={m}
        own={own}
        // Ticks derive from the members' receipt pointers at render
        // time — the message row itself only knows the local
        // sending/sent/failed machine (lib/receipts.ts).
        status={
          own ? deriveTickStatus(m, conversation.members, me.id) : undefined
        }
        senderName={
          isGroup && !own ? memberName(conversation, m.sender_id) : undefined
        }
        senderKey={String(m.sender_id)}
        // Group anatomy (§3.6): author name on the first bubble of a run,
        // 28px avatar on the last, spacer column in between. DMs never
        // show per-message avatars.
        showSenderName={isGroup && !own && !collapseAbove}
        showAvatar={isGroup && !own && !collapseBelow}
        hasAvatarColumn={isGroup && !own}
        collapseAbove={collapseAbove}
        collapseBelow={collapseBelow}
        quote={quote}
        onRetry={() => retryMessage(conversation.id, m.client_id, m.body)}
      />
    );
  });

  return (
    <section className={styles.pane}>
      <header className={styles.header}>
        {onBack && (
          <button
            className={`${styles.iconButton} ${styles.backButton}`}
            type="button"
            aria-label="Back to chats"
            onClick={onBack}
          >
            {iconChevronLeft}
          </button>
        )}
        {onShowInfo ? (
          <button
            className={styles.identityButton}
            type="button"
            aria-label="Group info"
            onClick={onShowInfo}
          >
            {headerIdentity}
          </button>
        ) : (
          <div className={styles.identity}>{headerIdentity}</div>
        )}
        <div className={styles.headerActions}>
          {/* Mocked controls per §3.4 — they open a `Coming Soon` toast. */}
          <button
            className={styles.iconButton}
            type="button"
            aria-label="Start video call (coming soon)"
            title="Coming Soon"
            onClick={comingSoon}
          >
            {iconVideo}
          </button>
          {!isGroup && (
            <button
              className={styles.iconButton}
              type="button"
              aria-label="Start voice call (coming soon)"
              title="Coming Soon"
              onClick={comingSoon}
            >
              {iconPhone}
            </button>
          )}
          <button
            className={styles.iconButton}
            type="button"
            aria-label="Search in conversation (coming soon)"
            title="Coming Soon"
            onClick={comingSoon}
          >
            {iconSearch}
          </button>
          <button
            className={styles.iconButton}
            type="button"
            aria-label={isGroup ? "Group info" : "More options"}
            title={isGroup ? "Group info" : "Coming Soon"}
            onClick={isGroup ? onShowInfo : comingSoon}
          >
            {iconKebab}
          </button>
        </div>
      </header>

      <div className={styles.timelineWrap}>
        <div className={styles.scroll} ref={scrollRef} onScroll={handleScroll}>
          {messages === undefined ? (
            <p className={styles.loading}>Loading messages…</p>
          ) : (
            <ul className={styles.messageList}>
              {/* §3.19 chat-start notice, above the first day chip. */}
              <li className={styles.encNotice}>
                {iconLock}
                Messages are end-to-end encrypted. No one outside of this
                chat, not even Signal, can read them.
              </li>
              {timeline}
              {typingMarker && (
                <li className={styles.typingRow}>
                  {isGroup && typistName && typingMarker && (
                    <span className={styles.typingAvatar} aria-hidden="true">
                      <Avatar
                        name={typistName}
                        size={28}
                        hashKey={String(typingMarker.user_id)}
                      />
                    </span>
                  )}
                  <TypingIndicator />
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Scroll-to-bottom pill with unread badge (§4). */}
        <button
          className={`${styles.scrollPill} ${
            pillVisible ? styles.scrollPillVisible : ""
          }`}
          type="button"
          aria-label={
            pillCount > 0
              ? `Scroll to bottom, ${pillCount} new ${
                  pillCount === 1 ? "message" : "messages"
                }`
              : "Scroll to bottom"
          }
          tabIndex={pillVisible ? 0 : -1}
          aria-hidden={!pillVisible}
          onClick={() => {
            setPillCount(0);
            scrollToBottom(true);
          }}
        >
          {pillCount > 0 && (
            <span className={styles.pillBadge}>
              {pillCount > 99 ? "99+" : pillCount}
            </span>
          )}
          {iconChevronDown}
        </button>
      </div>

      <Composer
        disabled={state.socket !== "open"}
        onSend={(body) => sendMessage(conversation.id, body)}
        onTyping={() => sendTyping(conversation.id)}
        onComingSoon={comingSoon}
      />

      <Toast toast={toast} />
    </section>
  );
}
