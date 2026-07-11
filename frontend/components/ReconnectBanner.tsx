"use client";

import { useEffect, useRef, useState } from "react";
import StatusTick from "./StatusTicks";
import { useChat } from "@/state/ChatProvider";
import styles from "./ReconnectBanner.module.css";

// Full-width strip at the very top of the app shell (DESIGN.md §3.13): the
// panes shift down beneath it, no overlay. Shows the 12px sending-spinner +
// `Reconnecting…` whenever the socket is anything but OPEN — the provider
// keeps retrying with backoff forever (a free-tier cold start takes
// ~30-60s), so this doubles as the "demo host is waking up" indicator.
// After reconnect it flips to `Connected` for 1.5s, then slides away (250ms).

const CONNECTED_HOLD_MS = 1500;
const SLIDE_OUT_MS = 250;

// The post-reconnect tail. "Reconnecting" itself is derived straight from
// the socket state; only this linger needs bookkeeping, and every setState
// lives in a timer callback (the react-hooks/set-state-in-effect rule this
// codebase lints under forbids synchronous setState in effect bodies).
type Linger = "none" | "connected" | "leaving";

export default function ReconnectBanner() {
  const { state } = useChat();
  const open = state.socket === "open";

  const [linger, setLinger] = useState<Linger>("none");
  // True once the strip has actually shown "Reconnecting…" — mounting with a
  // healthy socket must not play the Connected celebration.
  const wasDownRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasDownRef.current = true;
      return;
    }
    if (!wasDownRef.current) return;
    wasDownRef.current = false;
    const timers = [
      window.setTimeout(() => setLinger("connected"), 0),
      window.setTimeout(() => setLinger("leaving"), CONNECTED_HOLD_MS),
      window.setTimeout(
        () => setLinger("none"),
        CONNECTED_HOLD_MS + SLIDE_OUT_MS
      ),
    ];
    // A re-drop mid-linger clears the tail; the render below already shows
    // Reconnecting again (derived from `open`), and the next reconnect
    // restarts the chain from the top.
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [open]);

  const phase = !open ? "reconnecting" : linger;
  if (phase === "none") return null;

  return (
    <div
      className={`${styles.banner} ${
        phase === "leaving" ? styles.leaving : ""
      }`}
      role="status"
    >
      <span className={styles.glyph} aria-hidden="true">
        {/* Reuse the §3.8 tick glyphs: dashed-ring spinner while down,
            check-in-circle once the socket is back. */}
        <StatusTick status={phase === "reconnecting" ? "sending" : "sent"} />
      </span>
      {phase === "reconnecting" ? "Reconnecting…" : "Connected"}
    </div>
  );
}
