"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./NewChatModal.module.css";

// New chat — LEFT-PANE TAKEOVER, not a floating modal (DESIGN.md §3.15; the
// component keeps its blueprint name). Render-only: the parent swaps it in
// place of ConversationList (it fills 100% of the pane) and owns everything
// beyond the local search filter. Esc mirrors the back arrow (DESIGN.md §4).
//
// The same takeover doubles as the "Add members" picker (M3): the parent
// retitles it and simply omits the fixed rows' callbacks. onQueryChange lets
// the parent mirror the query into GET /api/users/search and merge server
// hits into `contacts` — the local name filter still applies on top.

export interface NewChatContact {
  id: number;
  name: string; // display_name
  phone: string; // subtitle line
}

interface Props {
  contacts: NewChatContact[];
  title?: string; // header title; defaults to the compose flow's "New chat"
  onSelectContact: (contactId: number) => void;
  onNewGroup?: () => void; // fixed "New group" row renders only when given
  onNoteToSelf?: () => void; // same for "Note to Self"
  onQueryChange?: (query: string) => void;
  onBack: () => void;
}

// --- Self-contained initials avatar (DESIGN.md §3.3) -----------------------
// Duplicated locally so this file imports nothing beyond React + its own CSS
// module; the wiring milestone may swap in the shared Avatar.

const AVATAR_PAIRS = [
  { bg: "var(--avatar-a100-bg, #e3e3fe)", fg: "var(--avatar-a100-fg, #3838f5)" },
  { bg: "var(--avatar-a110-bg, #dde7fc)", fg: "var(--avatar-a110-fg, #1251d3)" },
  { bg: "var(--avatar-a120-bg, #d8e8f0)", fg: "var(--avatar-a120-fg, #086da0)" },
  { bg: "var(--avatar-a130-bg, #cde4cd)", fg: "var(--avatar-a130-fg, #067906)" },
  { bg: "var(--avatar-a140-bg, #eae0fd)", fg: "var(--avatar-a140-fg, #661aff)" },
  { bg: "var(--avatar-a150-bg, #f5e3fe)", fg: "var(--avatar-a150-fg, #9f00f0)" },
  { bg: "var(--avatar-a160-bg, #f6d8ec)", fg: "var(--avatar-a160-fg, #b8057c)" },
  { bg: "var(--avatar-a170-bg, #f5d7d7)", fg: "var(--avatar-a170-fg, #be0404)" },
  { bg: "var(--avatar-a180-bg, #fef5d0)", fg: "var(--avatar-a180-fg, #836b01)" },
  { bg: "var(--avatar-a190-bg, #eae6d5)", fg: "var(--avatar-a190-fg, #7d6f40)" },
  { bg: "var(--avatar-a200-bg, #d2d2dc)", fg: "var(--avatar-a200-fg, #4f4f6d)" },
  { bg: "var(--avatar-a210-bg, #d7d7d9)", fg: "var(--avatar-a210-fg, #5c5c5c)" },
];

// §3.3 hash rule: sum of charCodes of the user id (else name) % 12.
function avatarPair(key: string) {
  let sum = 0;
  for (let i = 0; i < key.length; i++) sum += key.charCodeAt(i);
  return AVATAR_PAIRS[sum % AVATAR_PAIRS.length];
}

// "Alice Chen" -> "AC", "bob" -> "B"
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.[0] ?? "?";
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function InitialsAvatar({
  name,
  hashKey,
  size,
}: {
  name: string;
  hashKey?: string;
  size: number;
}) {
  const pair = avatarPair(hashKey ?? name);
  return (
    <span
      className={styles.avatar}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: pair.bg,
        color: pair.fg,
      }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------

export default function NewChatModal({
  contacts,
  title = "New chat",
  onSelectContact,
  onNewGroup,
  onNoteToSelf,
  onQueryChange,
  onBack,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q));
  }, [contacts, query]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onBack();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  return (
    <div className={styles.takeover}>
      <header className={styles.header}>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Back"
          onClick={onBack}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M17 10H4M9.5 4.5 4 10l5.5 5.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h2 className={styles.title}>{title}</h2>
      </header>

      <div className={styles.searchRow}>
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
          placeholder="Find by name"
          aria-label="Find by name"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onQueryChange?.(e.target.value);
          }}
          autoComplete="off"
        />
      </div>

      <div className={styles.list}>
        {/* Fixed rows before the contacts (DESIGN.md §3.15) — compose flow
            only; the "Add members" reuse passes neither callback. */}
        {onNewGroup && (
        <button className={styles.tile} type="button" onClick={onNewGroup}>
          <span className={styles.iconTile}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="7.5" cy="6.75" r="2.75" />
                <path d="M2.5 15.5c0-2.75 2.25-4.5 5-4.5s5 1.75 5 4.5" />
                <path d="M13.5 5.25a2.4 2.4 0 0 1 0 4.55" />
                <path d="M14.75 11.4c1.7.55 2.75 1.9 2.75 3.6" />
              </g>
            </svg>
          </span>
          <span className={styles.tileText}>
            <span className={styles.tileTitle}>New group</span>
          </span>
        </button>
        )}

        {onNoteToSelf && (
        <button
          className={styles.tile}
          type="button"
          onClick={onNoteToSelf}
        >
          <span className={styles.iconTile}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M4 16l1-3.5L13.6 3.9a1.8 1.8 0 0 1 2.5 2.5L7.5 15 4 16Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className={styles.tileText}>
            <span className={styles.tileTitle}>Note to Self</span>
          </span>
        </button>
        )}

        {filtered.map((contact) => (
          <button
            className={styles.tile}
            type="button"
            key={contact.id}
            onClick={() => onSelectContact(contact.id)}
          >
            <InitialsAvatar
              name={contact.name}
              hashKey={String(contact.id)}
              size={32}
            />
            <span className={styles.tileText}>
              <span className={styles.tileTitle}>{contact.name}</span>
              <span className={styles.tileSubtitle}>{contact.phone}</span>
            </span>
          </button>
        ))}

        {filtered.length === 0 && (
          <p className={styles.emptyText}>No contacts found</p>
        )}
      </div>
    </div>
  );
}
