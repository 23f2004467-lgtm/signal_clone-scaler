// Shared timestamp formatter (DESIGN.md §3.2 — one util used by BOTH the
// conversation list and the in-bubble metadata row, so the two surfaces can
// never disagree):
//   <1 min            -> "Now"
//   <1 h              -> "{n}m"
//   same calendar day -> "9:41 AM"
//   within past 7 d   -> "Mon"
//   <6 months         -> "Mar 5"
//   older             -> "Mar 5, 2025"

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatTimestamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const elapsed = now.getTime() - date.getTime();
  // Small negative skews (server clock ahead of ours) read as "Now" too.
  if (elapsed < MINUTE) return "Now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (elapsed < 7 * DAY) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  if (elapsed < 182 * DAY) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
