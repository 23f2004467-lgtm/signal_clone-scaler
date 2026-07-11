"use client";

import { useEffect, useState } from "react";
import styles from "./GroupInfoPanel.module.css";

// Group info — right-side overlay panel (DESIGN.md §3.17): 320px slide-in
// with hero avatar, member ListTiles with roles, admin-only add/remove/
// make-admin via callback props, and inline rename. The parent positions the
// panel (absolute right of the chat pane) and owns all data mutations.
//
// Esc priority (DESIGN.md §4): open row menu → cancel rename → close panel.

export type GroupMemberRole = "admin" | "member";

export interface GroupInfoMember {
  id: number;
  name: string; // display_name
  phone?: string; // subtitle line
  role: GroupMemberRole;
  online?: boolean; // presence dot on the avatar (from the live WS registry)
}

interface Props {
  groupId: number;
  groupName: string;
  members: GroupInfoMember[];
  viewerIsAdmin: boolean;
  viewerId?: number;
  onClose: () => void;
  onAddMembers: () => void;
  onRemoveMember: (memberId: number) => void;
  onMakeAdmin: (memberId: number) => void;
  onRename: (newName: string) => void;
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

export default function GroupInfoPanel({
  groupId,
  groupName,
  members,
  viewerIsAdmin,
  viewerId,
  onClose,
  onAddMembers,
  onRemoveMember,
  onMakeAdmin,
  onRename,
}: Props) {
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(groupName);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (menuFor !== null) {
        setMenuFor(null);
      } else if (editing) {
        setEditing(false);
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuFor, editing, onClose]);

  function startEditing() {
    setDraftName(groupName);
    setEditing(true);
  }

  function commitRename() {
    const name = draftName.trim();
    setEditing(false);
    if (name && name !== groupName) onRename(name);
  }

  return (
    <aside className={styles.panel} aria-label="Group info">
      <header className={styles.header}>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Close"
          onClick={onClose}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M5 5l10 10M15 5 5 15"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <h2 className={styles.title}>Group info</h2>
      </header>

      <div className={styles.scroll}>
        <div className={styles.hero}>
          <InitialsAvatar name={groupName} hashKey={String(groupId)} size={80} />
          {editing ? (
            <input
              className={styles.renameInput}
              type="text"
              aria-label="Group name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
              }}
              onBlur={commitRename}
              autoFocus
            />
          ) : (
            <div className={styles.nameRow}>
              <h3 className={styles.groupName}>{groupName}</h3>
              {viewerIsAdmin && (
                <button
                  className={styles.iconButtonSmall}
                  type="button"
                  aria-label="Rename group"
                  onClick={startEditing}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 16l1-3.5L13.6 3.9a1.8 1.8 0 0 1 2.5 2.5L7.5 15 4 16Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>
          )}
          <p className={styles.memberCount}>
            {members.length} {members.length === 1 ? "member" : "members"}
          </p>
        </div>

        <h4 className={styles.sectionHeader}>
          {members.length} {members.length === 1 ? "member" : "members"}
        </h4>

        {viewerIsAdmin && (
          <button className={styles.tile} type="button" onClick={onAddMembers}>
            <span className={styles.iconTile}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M10 4v12M4 10h12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className={styles.addLabel}>Add members</span>
          </button>
        )}

        {members.map((member) => {
          const isSelf = viewerId !== undefined && member.id === viewerId;
          const showMenuButton = viewerIsAdmin && !isSelf;
          return (
            <div className={styles.tileWrap} key={member.id}>
              <div className={styles.tile}>
                <span className={styles.avatarWrap}>
                  <InitialsAvatar
                    name={member.name}
                    hashKey={String(member.id)}
                    size={32}
                  />
                  {member.online && (
                    <span className={styles.onlineDot} aria-label="Online" />
                  )}
                </span>
                <span className={styles.tileText}>
                  <span className={styles.tileTitleRow}>
                    <span className={styles.tileTitle}>{member.name}</span>
                    {member.role === "admin" && (
                      <span className={styles.adminBadge}>Admin</span>
                    )}
                  </span>
                  {member.phone && (
                    <span className={styles.tileSubtitle}>{member.phone}</span>
                  )}
                </span>
                {showMenuButton && (
                  <button
                    className={styles.kebab}
                    type="button"
                    aria-label={`Actions for ${member.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menuFor === member.id}
                    onClick={() =>
                      setMenuFor(menuFor === member.id ? null : member.id)
                    }
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <circle cx="10" cy="4.5" r="1.5" />
                      <circle cx="10" cy="10" r="1.5" />
                      <circle cx="10" cy="15.5" r="1.5" />
                    </svg>
                  </button>
                )}
              </div>

              {menuFor === member.id && (
                <>
                  <button
                    className={styles.menuBackdrop}
                    type="button"
                    aria-label="Close menu"
                    onClick={() => setMenuFor(null)}
                  />
                  <div className={styles.menu} role="menu">
                    {member.role !== "admin" && (
                      <button
                        className={styles.menuItem}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuFor(null);
                          onMakeAdmin(member.id);
                        }}
                      >
                        Make admin
                      </button>
                    )}
                    <button
                      className={styles.menuItem}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuFor(null);
                        onRemoveMember(member.id);
                      }}
                    >
                      Remove from group
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
