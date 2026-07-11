"use client";

import type { ChatMessage, MessageStatus } from "@/lib/types";
import Avatar, { avatarFgColor } from "./Avatar";
import StatusTick from "./StatusTicks";
import { bubbleTime } from "./timeFormat";
import styles from "./MessageBubble.module.css";

// One bubble (DESIGN.md §3.6). Own messages sit right in Signal ultramarine;
// everyone else's sit left on the incoming gray. Consecutive-run grouping is
// computed by ChatPane (3-min / same-author / same-day window) and arrives as
// collapseAbove/collapseBelow: gaps tighten 6px -> 1px and the sender-side
// corners flatten 18px -> 4px. Group chats reserve a 28px avatar column on
// incoming rows; the avatar itself renders only on the last message of a run,
// and the tinted author name only on the first (§3.3 hash -> avatar -fg).
//
// Own bubbles carry the status tick (§3.8: spinner / check-in-circle /
// double outline / double FILLED, never blue) inside the metadata row;
// "failed" renders as the tap-to-retry line below the bubble instead.

// Tooltip copy per tick — the glyphs themselves are aria-hidden.
const STATUS_LABEL: Record<Exclude<MessageStatus, "failed">, string> = {
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
};

// Reply/quote block data (§3.7), resolved by ChatPane — from the loaded
// history when the original is on screen, else from the server's embedded
// reply_to summary. Absent when reply_to_id is unset.
export interface QuoteInfo {
  label: string; // "You" for own messages, else the author's display name
  hashKey: string; // String(user id) fed to the §3.3 hash for the accent
  ownQuoted: boolean; // quoted message is mine -> ultramarine accent
  text: string;
}

// Signal's reply arrow (curved, pointing left) — 20px, 1.5 stroke like every
// other glyph in the app (§3.4 icon conventions).
const iconReply = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M8.4 4.9 3.6 9.2a.55.55 0 0 0 0 .82l4.8 4.3M4 9.6h7.1a5.2 5.2 0 0 1 5.2 5.2v.9"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

interface Props {
  message: ChatMessage;
  own: boolean;
  // Tick state derived by the parent from the members' receipt pointers
  // (lib/receipts.ts) — the pointers live on the conversation, not the
  // message, so this component can't derive it alone. Undefined on other
  // people's bubbles.
  status?: MessageStatus;
  senderName?: string; // groups, incoming only: avatar initials + name label
  senderKey?: string; // String(sender id) — §3.3 color hash key
  showSenderName?: boolean; // first message of a run
  showAvatar?: boolean; // last message of a run
  hasAvatarColumn?: boolean; // groups, incoming: reserve the 28px column
  collapseAbove?: boolean; // runs with the previous message
  collapseBelow?: boolean; // runs with the next message
  quote?: QuoteInfo;
  // Clicking the quote scrolls to the original (§3.7) — only passed when the
  // original is actually in the loaded history.
  onQuoteClick?: () => void;
  // Starts a reply to this message. Only passed for persisted rows (id > 0):
  // an unacked optimistic bubble has no server id to reference yet. The
  // action is hover-revealed on pointer devices (§4) and always visible on
  // touch (DESIGN_BRIEF: no hidden affordances).
  onReply?: () => void;
  onRetry: () => void; // failed bubbles re-send with the SAME client_id
}

export default function MessageBubble({
  message,
  own,
  status,
  senderName,
  senderKey,
  showSenderName = false,
  showAvatar = false,
  hasAvatarColumn = false,
  collapseAbove = false,
  collapseBelow = false,
  quote,
  onQuoteClick,
  onReply,
  onRetry,
}: Props) {
  const failed = own && message.status === "failed";

  const bubbleClass = [
    styles.bubble,
    own ? styles.bubbleOwn : "",
    collapseAbove ? styles.flatTop : "",
    collapseBelow ? styles.flatBottom : "",
    failed ? styles.bubbleFailed : "",
  ]
    .filter(Boolean)
    .join(" ");

  const quoteAccent = quote
    ? quote.ownQuoted
      ? "var(--ultramarine)"
      : avatarFgColor(quote.hashKey)
    : undefined;

  const quoteInner = quote && (
    <>
      <span
        className={styles.quoteBar}
        style={{ background: quoteAccent }}
        aria-hidden="true"
      />
      <span className={styles.quoteBody}>
        <span
          className={styles.quoteAuthor}
          // Outgoing bubbles keep the white inherited color (§3.7);
          // incoming tints the author like the accent bar.
          style={own ? undefined : { color: quoteAccent }}
        >
          {quote.label}
        </span>
        <span className={styles.quoteText}>{quote.text}</span>
      </span>
    </>
  );

  return (
    <li
      className={`${styles.row} ${own ? styles.rowOwn : ""} ${
        collapseAbove ? styles.rowCollapsed : ""
      }`}
      // Anchor for "click the quote -> scroll to the original" (§3.7).
      // Optimistic bubbles (id 0) can't be quoted, so they carry no anchor.
      data-message-id={message.id > 0 ? message.id : undefined}
    >
      {hasAvatarColumn && (
        <span className={styles.avatarCol} aria-hidden="true">
          {showAvatar && senderName && (
            <Avatar name={senderName} size={28} hashKey={senderKey} />
          )}
        </span>
      )}
      <div className={styles.stack}>
        <div className={bubbleClass}>
          {showSenderName && senderName && (
            <span
              className={styles.sender}
              style={{ color: avatarFgColor(senderKey ?? senderName) }}
            >
              {senderName}
            </span>
          )}
          {quote &&
            // A real <button> only when the original is loaded and reachable;
            // otherwise the quote is plain, non-interactive context.
            (onQuoteClick ? (
              <button
                className={`${styles.quote} ${styles.quoteClickable}`}
                type="button"
                onClick={onQuoteClick}
                aria-label={`Go to quoted message from ${quote.label}`}
              >
                {quoteInner}
              </button>
            ) : (
              <div className={styles.quote}>{quoteInner}</div>
            ))}
          <span className={styles.body}>{message.body}</span>
          <span className={styles.meta}>
            <time dateTime={message.created_at}>
              {bubbleTime(message.created_at)}
            </time>
            {own && status && status !== "failed" && (
              <span className={styles.status} title={STATUS_LABEL[status]}>
                <StatusTick status={status} />
              </span>
            )}
          </span>
        </div>
        {failed && (
          <button className={styles.retry} type="button" onClick={onRetry}>
            Failed to send — tap to retry
          </button>
        )}
      </div>
      {onReply && (
        // §4 hover action bar (reply only — reactions are cut), floating
        // beside the bubble toward the center. CSS hides it until row hover
        // on pointer devices and keeps it always visible on touch.
        <button
          className={styles.replyAction}
          type="button"
          aria-label="Reply to this message"
          title="Reply"
          onClick={onReply}
        >
          {iconReply}
        </button>
      )}
    </li>
  );
}
