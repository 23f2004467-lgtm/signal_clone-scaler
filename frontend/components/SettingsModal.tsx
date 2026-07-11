"use client";

import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import styles from "./SettingsModal.module.css";

// Settings — true centered modal (DESIGN.md §3.18): scrim, 640×480 card, left
// nav column + section pane. Appearance is FULLY WORKING: System/Light/Dark
// radios write data-theme on <html> immediately and persist the choice to
// localStorage ("theme" key); System follows prefers-color-scheme live.
// Profile is read-only; Chats/Privacy/Notifications are Coming Soon
// placeholders, and Calls/Stories/Linked Devices sit below a divider as
// Coming Soon rows. Esc and scrim-click close.

interface SettingsUser {
  name: string;
  phone: string;
}

interface Props {
  user: SettingsUser;
  onClose: () => void;
}

type SectionId =
  | "profile"
  | "appearance"
  | "chats"
  | "privacy"
  | "notifications"
  | "calls"
  | "stories"
  | "linkedDevices";

type ThemeChoice = "system" | "light" | "dark";

const THEME_KEY = "theme";

function readStoredTheme(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return choice;
}

// --- Section glyphs (nav 20px, placeholder 32px) [approx shapes] -----------

function SectionGlyph({ id, size }: { id: SectionId; size: number }) {
  const shared = {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    fill: "none" as const,
    "aria-hidden": true as const,
  };
  const stroke = {
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "profile":
      return (
        <svg {...shared}>
          <circle cx="10" cy="6.5" r="3.25" {...stroke} />
          <path d="M3.75 16.5c0-3 2.8-4.75 6.25-4.75s6.25 1.75 6.25 4.75" {...stroke} />
        </svg>
      );
    case "appearance":
      return (
        <svg {...shared}>
          <path d="M10.5 3a7 7 0 1 0 6.5 6.5A5.5 5.5 0 0 1 10.5 3Z" {...stroke} />
        </svg>
      );
    case "chats":
      return (
        <svg {...shared}>
          <path
            d="M10 3.5c-3.9 0-7 2.7-7 6 0 1.7.8 3.2 2.1 4.3L4.5 17l3.2-1.2c.7.2 1.5.3 2.3.3 3.9 0 7-2.7 7-6.1s-3.1-6-7-6Z"
            {...stroke}
          />
        </svg>
      );
    case "privacy":
      return (
        <svg {...shared}>
          <rect x="5" y="9" width="10" height="7.5" rx="1.5" {...stroke} />
          <path d="M7 9V6.5a3 3 0 0 1 6 0V9" {...stroke} />
        </svg>
      );
    case "notifications":
      return (
        <svg {...shared}>
          <path
            d="M10 3.5c-2.9 0-4.75 2.2-4.75 5v3L3.75 14h12.5l-1.5-2.5v-3c0-2.8-1.85-5-4.75-5Z"
            {...stroke}
          />
          <path d="M8.5 16.5a1.6 1.6 0 0 0 3 0" {...stroke} />
        </svg>
      );
    case "calls":
      return (
        <svg {...shared}>
          <path
            d="M4.1 3.5h2.4c.3 0 .6.2.7.5l.9 2.6c.1.3 0 .6-.2.8L6.6 8.7a10.6 10.6 0 0 0 4.7 4.7l1.3-1.3c.2-.2.5-.3.8-.2l2.6.9c.3.1.5.4.5.7v2.4c0 .35-.3.65-.65.6C9.1 15.9 4.1 10.9 3.5 4.15c0-.35.25-.65.6-.65Z"
            {...stroke}
          />
        </svg>
      );
    case "stories":
      return (
        <svg {...shared}>
          <circle cx="10" cy="10" r="7" strokeDasharray="3.5 2.6" {...stroke} />
        </svg>
      );
    case "linkedDevices":
      return (
        <svg {...shared}>
          <rect x="3" y="4.5" width="14" height="9" rx="1.5" {...stroke} />
          <path d="M8 16.5h4M10 13.5v3" {...stroke} />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------

const MAIN_NAV: { id: SectionId; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "chats", label: "Chats" },
  { id: "privacy", label: "Privacy" },
  { id: "notifications", label: "Notifications" },
];

// Task addendum to §3.18: Coming Soon rows below a divider.
const COMING_SOON_NAV: { id: SectionId; label: string }[] = [
  { id: "calls", label: "Calls" },
  { id: "stories", label: "Stories" },
  { id: "linkedDevices", label: "Linked Devices" },
];

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function SettingsModal({ user, onClose }: Props) {
  const [section, setSection] = useState<SectionId>("profile");
  const [theme, setTheme] = useState<ThemeChoice>(readStoredTheme);

  // Apply + persist the theme; while on System, track OS scheme changes live.
  useEffect(() => {
    window.localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = resolveTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange() {
      document.documentElement.dataset.theme = resolveTheme("system");
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, [theme]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function renderSection() {
    if (section === "profile") {
      return (
        <div className={styles.profile}>
          {/* No hashKey: hashes on the name, matching the sidebar's own
              avatar (page.tsx), which also only ever sees the name. */}
          <Avatar name={user.name} size={80} />
          <p className={styles.profileName}>{user.name}</p>
          <p className={styles.profilePhone}>{user.phone}</p>
        </div>
      );
    }

    if (section === "appearance") {
      return (
        <div>
          <h3 className={styles.sectionTitle}>Theme</h3>
          <div role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map((option) => (
              <label className={styles.radioRow} key={option.value}>
                <input
                  className={styles.radioInput}
                  type="radio"
                  name="theme"
                  value={option.value}
                  checked={theme === option.value}
                  onChange={() => setTheme(option.value)}
                />
                <span className={styles.radioCircle} aria-hidden="true" />
                <span className={styles.radioLabel}>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }

    // Everything else: Coming Soon placeholder with a 32px glyph.
    return (
      <div className={styles.placeholder}>
        <span className={styles.placeholderGlyph}>
          <SectionGlyph id={section} size={32} />
        </span>
        Coming Soon
      </div>
    );
  }

  return (
    <div
      className={styles.scrim}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className={styles.titleRow}>
          <h2 className={styles.modalTitle}>Settings</h2>
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
        </div>

        <div className={styles.body}>
          <nav className={styles.nav} aria-label="Settings sections">
            {MAIN_NAV.map((item) => (
              <button
                className={
                  section === item.id
                    ? `${styles.navItem} ${styles.navItemSelected}`
                    : styles.navItem
                }
                type="button"
                key={item.id}
                aria-current={section === item.id}
                onClick={() => setSection(item.id)}
              >
                <SectionGlyph id={item.id} size={20} />
                {item.label}
              </button>
            ))}

            <div className={styles.navDivider} role="separator" />

            {COMING_SOON_NAV.map((item) => (
              <button
                className={
                  section === item.id
                    ? `${styles.navItem} ${styles.navItemSelected}`
                    : styles.navItem
                }
                type="button"
                key={item.id}
                aria-current={section === item.id}
                onClick={() => setSection(item.id)}
              >
                <SectionGlyph id={item.id} size={20} />
                {item.label}
              </button>
            ))}
          </nav>

          <div className={styles.section}>{renderSection()}</div>
        </div>
      </div>
    </div>
  );
}
