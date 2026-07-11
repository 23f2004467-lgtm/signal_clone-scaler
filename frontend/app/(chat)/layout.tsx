"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import ReconnectBanner from "@/components/ReconnectBanner";
import { getToken } from "@/lib/api";
import ChatProvider from "@/state/ChatProvider";
import styles from "./chat.module.css";

// Auth guard + outer shell for the two-pane app. The ChatProvider (the
// WebSocket) mounts HERE, so switching conversations never tears the
// socket down — only this layout's children re-render.
//
// Shell anatomy (DESIGN.md §2 + §3.13): .frame is the 100dvh column; the
// ReconnectBanner strip renders above .shell so the panes shift down while
// it shows instead of being overlaid.

// localStorage is an external store, so the token is read with React's
// useSyncExternalStore: the server snapshot is null (the prerendered HTML
// shows nothing), the client snapshot is the real token, and the 'storage'
// event keeps this tab honest if the user logs out from another tab.
function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function useToken(): string | null {
  return useSyncExternalStore(subscribe, getToken, () => null);
}

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const token = useToken();

  // Navigation is a side effect, so the redirect lives in an effect.
  useEffect(() => {
    if (!token) router.replace("/login");
  }, [token, router]);

  if (!token) return null; // never flash the chat shell at logged-out users

  return (
    <ChatProvider>
      <div className={styles.frame}>
        <ReconnectBanner />
        <div className={styles.shell}>{children}</div>
      </div>
    </ChatProvider>
  );
}
