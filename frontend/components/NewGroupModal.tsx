"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./NewGroupModal.module.css";

// New group — two-step LEFT-PANE TAKEOVER (DESIGN.md §3.16), matching real
// Signal's compose flow. All flow state (step, selection, name) lives here;
// results leave only through the callbacks. Esc mirrors the back arrow:
// step 2 → step 1 → onBack (DESIGN.md §4 Esc stack).

export interface GroupContact {
  id: number;
  name: string; // display_name
  phone?: string; // subtitle line
}

interface Props {
  contacts: GroupContact[];
  onCreate: (name: string, memberIds: number[]) => void;
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

function avatarPair(key: string) {
  let sum = 0;
  for (let i = 0; i < key.length; i++) sum += key.charCodeAt(i);
  return AVATAR_PAIRS[sum % AVATAR_PAIRS.length];
}

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

export default function NewGroupModal({ contacts, onCreate, onBack }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [groupName, setGroupName] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q));
  }, [contacts, query]);

  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => contacts.find((c) => c.id === id))
        .filter((c): c is GroupContact => c !== undefined),
    [contacts, selectedIds],
  );

  function handleBack() {
    if (step === 2) {
      setStep(1);
    } else {
      onBack();
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Mirrors the back arrow: step 2 → step 1 → exit takeover.
      if (step === 2) {
        setStep(1);
      } else {
        onBack();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [step, onBack]);

  function toggleMember(id: number) {
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id],
    );
  }

  function handleCreate() {
    const name = groupName.trim();
    if (!name || selectedIds.length === 0) return;
    onCreate(name, selectedIds);
  }

  const chips = selected.length > 0 && (
    <div className={styles.chips}>
      {selected.map((contact) => (
        <span className={styles.chip} key={contact.id}>
          <InitialsAvatar
            name={contact.name}
            hashKey={String(contact.id)}
            size={20}
          />
          <span className={styles.chipName}>{contact.name}</span>
          <button
            className={styles.chipRemove}
            type="button"
            aria-label={`Remove ${contact.name}`}
            onClick={() => toggleMember(contact.id)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </span>
      ))}
    </div>
  );

  return (
    <div className={styles.takeover}>
      <header className={styles.header}>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Back"
          onClick={handleBack}
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
        <h2 className={styles.title}>
          {step === 1 ? "Add members" : "Name this group"}
        </h2>
      </header>

      {step === 1 ? (
        <>
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
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>

          {chips}

          <div className={styles.list}>
            {filtered.map((contact) => {
              const checked = selectedIds.includes(contact.id);
              return (
                <button
                  className={styles.tile}
                  type="button"
                  key={contact.id}
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggleMember(contact.id)}
                >
                  <InitialsAvatar
                    name={contact.name}
                    hashKey={String(contact.id)}
                    size={32}
                  />
                  <span className={styles.tileText}>
                    <span className={styles.tileTitle}>{contact.name}</span>
                    {contact.phone && (
                      <span className={styles.tileSubtitle}>{contact.phone}</span>
                    )}
                  </span>
                  <span
                    className={
                      checked
                        ? `${styles.checkbox} ${styles.checkboxChecked}`
                        : styles.checkbox
                    }
                  >
                    {checked && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M2.5 6.5 5 9l4.5-5.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className={styles.emptyText}>No contacts found</p>
            )}
          </div>

          <button
            className={styles.primaryButton}
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => setStep(2)}
          >
            Next
          </button>
        </>
      ) : (
        <>
          {/* 64px group avatar placeholder: camera glyph on an overlay circle. */}
          <div className={styles.groupAvatarPlaceholder} aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <g stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                <path d="M9.2 6.5 10.4 4.5h3.2l1.2 2H19a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V8A1.5 1.5 0 0 1 5 6.5h4.2Z" />
                <circle cx="12" cy="12.75" r="3.5" />
              </g>
            </svg>
          </div>

          <input
            className={styles.nameInput}
            type="text"
            placeholder="Group name (required)"
            aria-label="Group name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            autoComplete="off"
            autoFocus
          />

          {/* Member chips summary (still removable on this step). */}
          <div className={styles.chipsSummary}>{chips}</div>

          <button
            className={styles.primaryButton}
            type="button"
            disabled={groupName.trim() === "" || selectedIds.length === 0}
            onClick={handleCreate}
          >
            Create
          </button>
        </>
      )}
    </div>
  );
}
