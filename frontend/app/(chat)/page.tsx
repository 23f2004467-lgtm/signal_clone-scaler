"use client";

import { useEffect, useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import ChatPane from "@/components/ChatPane";
import ConversationList from "@/components/ConversationList";
import EmptyState from "@/components/EmptyState";
import GroupInfoPanel, {
  type GroupInfoMember,
} from "@/components/GroupInfoPanel";
import NewChatModal, { type NewChatContact } from "@/components/NewChatModal";
import NewGroupModal from "@/components/NewGroupModal";
import SettingsModal from "@/components/SettingsModal";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { useChat } from "@/state/ChatProvider";
import styles from "./chat.module.css";

// The two-pane shell: ConversationList | ChatPane. All chat state lives in
// the ChatProvider (mounted by the layout, one level up); this page wires the
// left pane's selection to the right pane and owns the M3/M4 surfaces: the
// compose takeovers that replace the left pane (DESIGN.md §3.15/§3.16), the
// group info panel overlaying the right pane's edge (§3.17), the Settings
// modal (§3.18), and the ≤640px single-pane navigation state (§2 — a null
// selection shows the list; ChatPane's back chevron clears the selection).

// What currently occupies the left pane. "Add members" carries the target
// group's id so the takeover simply stops rendering if that group disappears
// (e.g. another admin removed me mid-pick) — no cleanup effect needed.
type ComposeMode = "none" | "chat" | "group" | { addTo: number };

const THEME_KEY = "theme"; // same key SettingsModal persists

export default function ChatPage() {
  const {
    me,
    state,
    loadError,
    selectedId,
    selectConversation,
    openDm,
    createGroup,
    addMember,
    removeMember,
    renameGroup,
    logout,
  } = useChat();
  const conversations = state.conversations;
  const selected = conversations?.find((c) => c.id === selectedId) ?? null;

  const [compose, setCompose] = useState<ComposeMode>("none");
  // The address book, fetched once when a compose surface first opens
  // (contacts are stable enough for a session; a refresh refetches).
  const [contacts, setContacts] = useState<User[] | null>(null);
  // Server-side user search (GET /api/users/search) mirroring the takeover's
  // query — finds people who aren't contacts yet.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<User[]>([]);
  // Which conversation's info panel is open. Keyed by id (not a boolean) so
  // switching or losing the selection hides the panel by plain rendering
  // logic instead of a state-resetting effect.
  const [infoOpenFor, setInfoOpenFor] = useState<number | null>(null);
  // M4 chrome: the Settings modal (own avatar or the ⋮ menu) and the ⋮ menu.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Every takeover transition goes through here: each surface starts with a
  // fresh search. (Resetting in the event handler, not an effect, per the
  // react-hooks lint rules this codebase builds under.)
  function switchCompose(mode: ComposeMode) {
    setCompose(mode);
    setSearchQuery("");
    setSearchHits([]);
  }

  // ⋮ → Toggle theme: flip the currently applied theme and persist it with
  // the same localStorage key the SettingsModal switcher uses.
  function toggleTheme() {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(THEME_KEY, next);
    setMenuOpen(false);
  }

  // Esc closes the ⋮ menu (§4 Esc stack: menus close first).
  useEffect(() => {
    if (!menuOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  // Lazy contacts load, first time any compose surface opens.
  useEffect(() => {
    if (compose === "none" || contacts !== null) return;
    let cancelled = false;
    api
      .listContacts()
      .then((list) => {
        if (!cancelled) setContacts(list);
      })
      .catch((err: unknown) => {
        // The takeover just shows "No contacts found"; search still works.
        console.error("contacts load failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [compose, contacts]);

  // Debounced server search. State changes only in the promise callback; an
  // emptied query never fetches (the backend returns [] for empty q anyway)
  // and the render below ignores hits while the query is empty.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .searchUsers(q)
        .then((hits) => {
          if (!cancelled) setSearchHits(hits);
        })
        .catch(() => {
          // search is additive sugar over the contact list; stay silent
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  // contacts + search hits, deduped by id, as the takeovers' row shape.
  const contactRows: NewChatContact[] = useMemo(() => {
    const byId = new Map<number, User>();
    for (const user of contacts ?? []) byId.set(user.id, user);
    if (searchQuery.trim()) {
      for (const user of searchHits) {
        if (!byId.has(user.id)) byId.set(user.id, user);
      }
    }
    return [...byId.values()]
      .filter((user) => user.id !== me?.id)
      .map((user) => ({
        id: user.id,
        name: user.display_name,
        phone: user.phone,
      }));
  }, [contacts, searchHits, searchQuery, me]);

  // "Add members" renders only while its target group is still the selected
  // conversation; anything else falls through to the normal list.
  const addingTo =
    typeof compose === "object" &&
    selected?.type === "group" &&
    selected.id === compose.addTo
      ? selected
      : null;

  // ...and must only offer people who aren't in the group already.
  const addableRows = useMemo(() => {
    if (!addingTo) return [];
    const memberIds = new Set(addingTo.members.map((m) => m.id));
    return contactRows.filter((row) => !memberIds.has(row.id));
  }, [contactRows, addingTo]);

  // ---- M3 actions (REST via the provider; it dispatches the results) ----
  // Failures other than 401 (which kicks to login inside the provider) keep
  // the current surface open so the user can simply try again.

  function handleSelectContact(contactId: number) {
    openDm(contactId)
      .then(() => switchCompose("none"))
      .catch((err: unknown) => console.error("could not open DM:", err));
  }

  function handleCreateGroup(name: string, memberIds: number[]) {
    createGroup(name, memberIds)
      .then(() => switchCompose("none"))
      .catch((err: unknown) => console.error("could not create group:", err));
  }

  function handleAddMember(contactId: number) {
    if (!addingTo) return;
    addMember(addingTo.id, contactId)
      .then(() => switchCompose("none"))
      .catch((err: unknown) => console.error("could not add member:", err));
  }

  // The panel's props for the open group. MemberInfo has no phone (the
  // backend's MemberOut doesn't carry one), so the username is the subtitle.
  const infoMembers: GroupInfoMember[] = (selected?.members ?? []).map((m) => ({
    id: m.id,
    name: m.display_name,
    phone: m.username,
    role: m.role,
    online: m.is_online ?? false,
  }));
  const viewerIsAdmin =
    selected?.members.find((m) => m.id === me?.id)?.role === "admin";

  // Phone navigation (§2): ChatPane's back chevron clears the selection and
  // returns to the list. The chevron itself lives in ChatPane's header; this
  // object rides a JSX spread so the page compiles independently of when
  // ChatPane's Props declare the callback.
  const paneNav = { onBack: () => selectConversation(null) };

  return (
    <div
      className={`${styles.container} ${selected ? styles.chatOpen : ""}`}
    >
      <aside className={styles.sidebar}>
        {compose === "chat" ? (
          <NewChatModal
            contacts={contactRows}
            onSelectContact={handleSelectContact}
            onNewGroup={() => switchCompose("group")}
            onQueryChange={setSearchQuery}
            onBack={() => switchCompose("none")}
          />
        ) : compose === "group" ? (
          <NewGroupModal
            contacts={contactRows}
            onCreate={handleCreateGroup}
            // Back from step 1 returns to the New chat list it came from.
            onBack={() => switchCompose("chat")}
          />
        ) : addingTo ? (
          <NewChatModal
            title="Add members"
            contacts={addableRows}
            onSelectContact={handleAddMember}
            onQueryChange={setSearchQuery}
            onBack={() => switchCompose("none")}
          />
        ) : (
          <>
            <header className={styles.sidebarHeader}>
              <button
                className={styles.avatarButton}
                type="button"
                aria-label="Profile and settings"
                title="Settings"
                onClick={() => setSettingsOpen(true)}
              >
                {/* name-hashed (no hashKey) to color-match the Settings
                    profile avatar, which only ever sees the name. */}
                {me && <Avatar name={me.display_name} size={28} />}
              </button>
              <h1 className={styles.sidebarTitle}>Chats</h1>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="New chat"
                title="New chat"
                onClick={() => switchCompose("chat")}
              >
                {/* pencil/compose glyph (DESIGN.md §3.1) */}
                <svg
                  width="20"
                  height="20"
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
              <span className={styles.menuAnchor}>
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label="More options"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  {/* ⋮ glyph (§3.1) */}
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <g fill="currentColor">
                      <circle cx="10" cy="4.5" r="1.5" />
                      <circle cx="10" cy="10" r="1.5" />
                      <circle cx="10" cy="15.5" r="1.5" />
                    </g>
                  </svg>
                </button>
                {menuOpen && (
                  <>
                    <span
                      className={styles.menuScrim}
                      onClick={() => setMenuOpen(false)}
                    />
                    <span className={styles.menu} role="menu">
                      <button
                        className={styles.menuItem}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          setSettingsOpen(true);
                        }}
                      >
                        Settings
                      </button>
                      <button
                        className={styles.menuItem}
                        type="button"
                        role="menuitem"
                        onClick={toggleTheme}
                      >
                        Toggle theme
                      </button>
                      <button
                        className={styles.menuItem}
                        type="button"
                        role="menuitem"
                        onClick={logout}
                      >
                        Sign out
                      </button>
                    </span>
                  </>
                )}
              </span>
            </header>

            {loadError && (
              <p className={`${styles.sidebarStatus} ${styles.errorText}`}>
                {loadError}
              </p>
            )}
            {!loadError && conversations === null && (
              <p className={styles.sidebarStatus}>Loading chats…</p>
            )}
            {!loadError && conversations !== null && me !== null && (
              <ConversationList
                conversations={conversations}
                currentUserId={me.id}
                selectedId={selectedId}
                typing={state.typing}
                onSelect={(id) => {
                  // A new selection also retires any open info panel — the
                  // panel belongs to exactly one conversation.
                  setInfoOpenFor(null);
                  selectConversation(id);
                }}
              />
            )}
          </>
        )}
      </aside>

      <main className={styles.main}>
        {selected && me ? (
          <>
            {/* key -> a fresh ChatPane per conversation, so scroll position
                and in-flight effects never leak across selections. */}
            <ChatPane
              key={selected.id}
              conversation={selected}
              me={me}
              {...paneNav}
              onShowInfo={
                selected.type === "group"
                  ? () => setInfoOpenFor(selected.id)
                  : undefined
              }
            />
            {infoOpenFor === selected.id && selected.type === "group" && (
              <div className={styles.infoPanelAnchor}>
                <GroupInfoPanel
                  groupId={selected.id}
                  groupName={selected.name ?? "Unnamed group"}
                  members={infoMembers}
                  viewerIsAdmin={viewerIsAdmin}
                  viewerId={me.id}
                  onClose={() => setInfoOpenFor(null)}
                  onAddMembers={() => switchCompose({ addTo: selected.id })}
                  onRemoveMember={(memberId) => {
                    removeMember(selected.id, memberId).catch((err: unknown) =>
                      console.error("could not remove member:", err)
                    );
                  }}
                  // No role-change endpoint exists in the REST surface
                  // (blueprint §7), so "Make admin" is deliberately inert.
                  onMakeAdmin={() => {}}
                  onRename={(name) => {
                    renameGroup(selected.id, name).catch((err: unknown) =>
                      console.error("could not rename group:", err)
                    );
                  }}
                />
              </div>
            )}
          </>
        ) : (
          // ≥641px, nothing selected: the §3.12 empty state, never a blank
          // div (≤640px this pane is hidden entirely — the list is home).
          <EmptyState />
        )}
      </main>

      {settingsOpen && me && (
        <SettingsModal
          user={{ name: me.display_name, phone: me.phone }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
