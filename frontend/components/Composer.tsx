"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import styles from "./Composer.module.css";

// The composer (DESIGN.md §3.10): emoji ghost button, 18px-radius pill input
// on --color-input-bg (auto-growing 32→72px), a mic ghost button that swaps
// to the 32px ultramarine send circle the moment text is non-empty, and the
// paperclip rightmost. Emoji/mic/attach are inert placeholders — those
// features are cut. Enter sends, Shift+Enter inserts a newline; everything
// is disabled (opacity .5, "Waiting to reconnect…") while the socket is down.

// Typing frames go out at most one per 2.5s while keystrokes keep coming
// (§5: "Keystroke, throttled to ~1 per 2–3 s"). The receiving side re-arms
// a 3s clear per frame, so this cadence keeps the dots lit continuously.
const TYPING_THROTTLE_MS = 2500;

// Input content box: min 32px (one line + 6px block padding), max 72px
// (~3 lines), then it scrolls internally (§3.10).
const INPUT_MIN_PX = 32;
const INPUT_MAX_PX = 72;

const iconEmoji = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="7.3" cy="8.3" r="1" fill="currentColor" />
    <circle cx="12.7" cy="8.3" r="1" fill="currentColor" />
    <path
      d="M6.9 12a3.9 3.9 0 0 0 6.2 0"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const iconAttach = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="m16.1 9.6-5.9 5.9a3.7 3.7 0 0 1-5.2-5.2L11.3 4a2.5 2.5 0 0 1 3.5 3.5l-6.3 6.3a1.3 1.3 0 0 1-1.8-1.8l5.9-5.9"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const iconMic = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect
      x="7.75"
      y="2.75"
      width="4.5"
      height="8.5"
      rx="2.25"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M4.9 9.6a5.1 5.1 0 0 0 10.2 0M10 14.7v2.55"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const iconSend = (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <path
      d="M2.94 8.9c-1.02.35-1.02 1.79 0 2.14l5.3 1.84c.18.06.32.2.38.38l1.84 5.3c.35 1.02 1.79 1.02 2.14 0L17.32 4.1c.32-.92-.56-1.8-1.48-1.48L2.94 8.9Z"
      fill="currentColor"
    />
  </svg>
);

interface Props {
  disabled: boolean;
  onSend: (body: string) => void;
  onTyping: () => void;
  /** §3.14: mocked controls (emoji/mic/attach) open a `Coming Soon` toast. */
  onComingSoon?: () => void;
}

export default function Composer({
  disabled,
  onSend,
  onTyping,
  onComingSoon,
}: Props) {
  const [body, setBody] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // Throttle bookkeeping, not render state. Starts at 0 so the very first
  // keystroke notifies immediately.
  const lastTypingSentRef = useRef(0);

  function autoGrow() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = `${INPUT_MIN_PX}px`;
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_PX)}px`;
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setBody(e.target.value);
    autoGrow();
    const now = Date.now();
    if (now - lastTypingSentRef.current >= TYPING_THROTTLE_MS) {
      lastTypingSentRef.current = now;
      onTyping();
    }
  }

  function submit() {
    const text = body.trim();
    if (!text || disabled) return;
    onSend(text);
    setBody("");
    // Sending keeps focus and resets the input height to one line (§4).
    const el = inputRef.current;
    if (el) {
      el.style.height = `${INPUT_MIN_PX}px`;
      el.focus();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  // Enter sends; Shift+Enter falls through to the native newline (§4).
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const hasText = body.trim() !== "";

  return (
    <form className={styles.composer} onSubmit={handleSubmit}>
      {/* Mocked control (§3.10) — the emoji picker is cut; toast instead. */}
      <button
        className={styles.iconButton}
        type="button"
        aria-label="Insert emoji (coming soon)"
        title="Coming Soon"
        disabled={disabled}
        onClick={onComingSoon}
      >
        {iconEmoji}
      </button>

      <textarea
        className={styles.input}
        ref={inputRef}
        rows={1}
        placeholder={disabled ? "Waiting to reconnect…" : "Message"}
        value={body}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label="Message"
        autoComplete="off"
      />

      {/* Mic ghost swaps to the ultramarine send circle on first character. */}
      <span className={styles.sendSlot}>
        {hasText ? (
          <button
            className={styles.sendButton}
            type="submit"
            aria-label="Send message"
            disabled={disabled}
          >
            {iconSend}
          </button>
        ) : (
          <button
            className={`${styles.iconButton} ${styles.slotButton}`}
            type="button"
            aria-label="Record voice message (coming soon)"
            title="Coming Soon"
            disabled={disabled}
            onClick={onComingSoon}
          >
            {iconMic}
          </button>
        )}
      </span>

      {/* Mocked control (§3.10) — attachments are cut; toast instead. */}
      <button
        className={styles.iconButton}
        type="button"
        aria-label="Attach file (coming soon)"
        title="Coming Soon"
        disabled={disabled}
        onClick={onComingSoon}
      >
        {iconAttach}
      </button>
    </form>
  );
}
