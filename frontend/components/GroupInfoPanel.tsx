"use client";

import { useEffect, useState } from "react";
import Avatar from "./Avatar";
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
          <Avatar name={groupName} hashKey={String(groupId)} size={80} />
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
                  <Avatar
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
