"use client";

import { useState } from "react";
import Avatar from "./Avatar";
import StatusTick, { type TickStatus } from "./StatusTicks";
import TypingIndicator from "./TypingIndicator";
import { titleOf } from "@/lib/conversation";
import { formatTimestamp } from "@/lib/formatTimestamp";
import { deriveTickStatus } from "@/lib/receipts";
import type { ConversationSummary } from "@/lib/types";
import type { ChatState } from "@/state/chatReducer";
import styles from "./ConversationList.module.css";

// The left pane below the header: search row + one 72px row per conversation,
// newest activity first (the server already orders GET /api/conversations
// that way). Styled to DESIGN.md §3.1 (search) and §3.2 (rows).

interface Props {
  conversations: ConversationSummary[];
  currentUserId: number;
  selectedId: number | null;
  // conversation_id -> active typing marker; while present, the row's
  // preview line shows the bare typing dots instead of the last message.
  typing: ChatState["typing"];
  onSelect: (id: number) => void;
}

// §3.2 preview tick: when the last message is our own, derive its tick state
// from the members' receipt pointers — the same MIN-semantics rule the
// bubbles use (lib/receipts.ts). The preview row is a persisted message by
// definition, so it enters the machine at "sent".
function previewTick(
  c: ConversationSummary,
  currentUserId: number
): TickStatus | null {
  const last = c.last_message;
  if (!last || last.sender_id !== currentUserId) return null;
  const status = deriveTickStatus(
    {
      ...last,
      conversation_id: c.id,
      reply_to_id: null,
      client_id: "",
      status: "sent",
    },
    c.members,
    currentUserId
  );
  // "sending"/"failed" are client-only states a persisted preview never has.
  return status === "failed" || status === "sending" ? "sent" : status;
}

// §3.3: DMs hash on the peer's user id (matching the compose takeovers);
// groups hash on the group id.
function avatarHashKey(c: ConversationSummary, currentUserId: number): string {
  if (c.type === "direct") {
    const other = c.members.find((m) => m.id !== currentUserId);
    if (other) return String(other.id);
  }
  return String(c.id);
}

export default function ConversationList({
  conversations,
  currentUserId,
  selectedId,
  typing,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");

  // Search is a client-side filter of the already-fetched list (blueprint §10).
  const q = query.trim().toLowerCase();
  const visible = q
    ? conversations.filter((c) =>
        titleOf(c, currentUserId).toLowerCase().includes(q)
      )
    : conversations;

  return (
    <div className={styles.list}>
      {/* Search row (§3.1): 28px field, 8px radius, magnifier at left 8px. */}
      <div className={styles.searchBox}>
        <svg
          className={styles.searchIcon}
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M10.5 10.5 14 14"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search conversations"
          autoComplete="off"
        />
      </div>

      {visible.length === 0 && (
        <p className={styles.empty}>
          {conversations.length === 0
            ? "No conversations yet"
            : "No chats match your search"}
        </p>
      )}

      <ul className={styles.rows}>
        {visible.map((c) => {
          const title = titleOf(c, currentUserId);
          const tick = previewTick(c, currentUserId);
          return (
            <li key={c.id}>
              <button
                className={`${styles.row} ${
                  c.id === selectedId ? styles.rowSelected : ""
                }`}
                type="button"
                onClick={() => onSelect(c.id)}
              >
                <Avatar
                  name={title}
                  hashKey={avatarHashKey(c, currentUserId)}
                  size={48}
                />
                <span className={styles.rowText}>
                  <span className={styles.rowTop}>
                    <span className={styles.title}>{title}</span>
                    {c.last_message && (
                      <span className={styles.time}>
                        {formatTimestamp(c.last_message.created_at)}
                      </span>
                    )}
                  </span>
                  <span className={styles.rowBottom}>
                    <span className={styles.preview}>
                      {typing[c.id] ? (
                        // Signal's typing-animation-bare (§3.2/§3.9):
                        // opacity-only dots take over the preview slot.
                        <TypingIndicator bare />
                      ) : (
                        <>
                          {tick && (
                            <span className={styles.previewTick}>
                              <StatusTick status={tick} />
                            </span>
                          )}
                          {/* Real Signal leaves the preview blank for a
                              message-less conversation — no placeholder copy. */}
                          <span className={styles.previewText}>
                            {c.last_message?.body ?? ""}
                          </span>
                        </>
                      )}
                    </span>
                    {c.unread_count > 0 && (
                      <span className={styles.unreadBadge}>
                        {c.unread_count > 99 ? "99+" : c.unread_count}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
