"use client";

import type { ChatMessage, MessageStatus } from "@/lib/types";
import Avatar from "./Avatar";
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

// §3.3 avatar color pairs, foreground halves, in palette order A100…A210.
// Hash rule: sum of charCodes of (user id, else name) % 12 — identical to
// the shared Avatar's pairOf(), and fed the same String(user id) hashKey the
// rest of the app uses, so a sender's bubble avatar, list avatar and tinted
// author name always agree.
const AVATAR_FG_VARS = [
  "--avatar-a100-fg",
  "--avatar-a110-fg",
  "--avatar-a120-fg",
  "--avatar-a130-fg",
  "--avatar-a140-fg",
  "--avatar-a150-fg",
  "--avatar-a160-fg",
  "--avatar-a170-fg",
  "--avatar-a180-fg",
  "--avatar-a190-fg",
  "--avatar-a200-fg",
  "--avatar-a210-fg",
];

export function avatarFgColor(hashKey: string): string {
  let sum = 0;
  for (let i = 0; i < hashKey.length; i++) sum += hashKey.charCodeAt(i);
  return `var(${AVATAR_FG_VARS[sum % AVATAR_FG_VARS.length]})`;
}

// Reply/quote block data (§3.7), resolved by ChatPane from the loaded
// history — absent when reply_to_id is unset or the original isn't loaded.
export interface QuoteInfo {
  label: string; // "You" for own messages, else the author's display name
  hashKey: string; // String(user id) fed to the §3.3 hash for the accent
  ownQuoted: boolean; // quoted message is mine -> ultramarine accent
  text: string;
}

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

  return (
    <li
      className={`${styles.row} ${own ? styles.rowOwn : ""} ${
        collapseAbove ? styles.rowCollapsed : ""
      }`}
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
          {quote && (
            <div className={styles.quote}>
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
            </div>
          )}
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
    </li>
  );
}
