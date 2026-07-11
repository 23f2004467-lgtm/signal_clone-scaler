"use client";

import { useEffect, useMemo, useState } from "react";
import Avatar from "./Avatar";
import styles from "./NewChatModal.module.css";

// New chat — LEFT-PANE TAKEOVER, not a floating modal (DESIGN.md §3.15; the
// component keeps its blueprint name). Render-only: the parent swaps it in
// place of ConversationList (it fills 100% of the pane) and owns everything
// beyond the local search filter. Esc mirrors the back arrow (DESIGN.md §4).
//
// The same takeover doubles as the "Add members" picker (M3): the parent
// retitles it and simply omits the "New group" callback. onQueryChange lets
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
  onQueryChange?: (query: string) => void;
  onBack: () => void;
}

export default function NewChatModal({
  contacts,
  title = "New chat",
  onSelectContact,
  onNewGroup,
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
        {/* Fixed row before the contacts (DESIGN.md §3.15) — compose flow
            only; the "Add members" reuse omits the callback. */}
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

        {filtered.map((contact) => (
          <button
            className={styles.tile}
            type="button"
            key={contact.id}
            onClick={() => onSelectContact(contact.id)}
          >
            <Avatar
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
