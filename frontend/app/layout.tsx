import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal Clone",
  description: "A Signal clone — Next.js, FastAPI, SQLite, plain WebSockets.",
};

// viewport-fit=cover so env(safe-area-inset-*) is non-zero on notched phones
// (DESIGN_BRIEF mechanical rule 3); theme-color matches the left pane.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f0f0f0" },
    { media: "(prefers-color-scheme: dark)", color: "#2e2e2e" },
  ],
};

// Theme bootstrap (DESIGN.md §5.1): runs synchronously in <head>, before
// first paint, so there is never a flash of the wrong theme. Resolution
// order matches SettingsModal: localStorage "theme" ("light"/"dark" win;
// "system"/absent follow prefers-color-scheme). The change listener keeps
// System users live-synced with the OS even while Settings is closed.
const themeBootstrap = `(function () {
  try {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    function apply() {
      var stored = localStorage.getItem("theme");
      var dark = stored === "dark" || (stored !== "light" && mq.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    }
    apply();
    mq.addEventListener("change", apply);
  } catch (e) {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // data-theme is written by the script below before React hydrates, so the
    // server-rendered <html> never matches — suppress that one warning.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
