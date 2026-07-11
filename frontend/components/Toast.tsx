"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Toast.module.css";

// §3.14 toast. Purely presentational chrome: the owner keeps a
// `{ id, text } | null` in local UI state and bumps `id` on every trigger so
// repeat clicks replace the toast (one at a time) and restart the 3s clock.

export interface ToastData {
  id: number;
  text: string;
}

const SHOW_MS = 3000; // auto-dismiss (§3.14)
const EXIT_MS = 150; // 120ms exit animation + a little slack

export default function Toast({ toast }: { toast: ToastData | null }) {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("gone");
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!toast) {
      setPhase("gone");
      return;
    }
    setPhase("in");
    const hide = setTimeout(() => setPhase("out"), SHOW_MS);
    const gone = setTimeout(() => setPhase("gone"), SHOW_MS + EXIT_MS);
    // Hidden/background documents freeze the CSS animation clock at progress
    // 0 — the enter keyframe's opacity 0 — which would leave the toast
    // invisible (e.g. under headless capture). If the 120ms enter animation
    // hasn't advanced well after it should have finished, jump it to its end
    // state. No-op in a normal visible browser.
    const unstick = setTimeout(() => {
      boxRef.current?.getAnimations().forEach((a) => {
        if (a.playState === "running" && !a.currentTime) a.finish();
      });
    }, 300);
    return () => {
      clearTimeout(hide);
      clearTimeout(gone);
      clearTimeout(unstick);
    };
  }, [toast]);

  if (!toast || phase === "gone") return null;

  return (
    <div
      key={toast.id}
      ref={boxRef}
      className={`${styles.toast} ${phase === "out" ? styles.leaving : ""}`}
      role="status"
    >
      {toast.text}
    </div>
  );
}
