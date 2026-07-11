// Chat-pane time formatting (DESIGN.md §3.2 format table + §3.5 day labels
// + §3.6 in-bubble metadata). Kept beside the components that consume it —
// lib/ is frozen functional code and Builder A owns the list's own util.

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function isSameDay(aIso: string, bIso: string): boolean {
  return startOfDay(new Date(aIso)) === startOfDay(new Date(bIso));
}

// Day-divider chip label (§3.5): `Today`, `Yesterday`, weekday name within
// the past 7 days, else `Feb 12, 2026`.
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// In-bubble metadata timestamp (§3.6 order: `Now` / `{n}m` / clock time).
// Server clocks can run slightly ahead of the client; a small negative diff
// still reads `Now`.
export function bubbleTime(iso: string, nowMs: number = Date.now()): string {
  const t = new Date(iso).getTime();
  const diff = nowMs - t;
  if (diff < MINUTE) return "Now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
