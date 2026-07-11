import styles from "./Avatar.module.css";

// Initials avatar (DESIGN.md §3.3): perfect circle, pastel background with
// saturated initials from Signal's 12 verified pairs (A100…A210, tokens.css).
// Never white text on a saturated background. Derived, never uploaded
// (blueprint §10) — deterministic hash, zero server involvement.

// Ordered pair list A100…A210; index = hash % 12.
const AVATAR_PAIRS = [
  { bg: "var(--avatar-a100-bg)", fg: "var(--avatar-a100-fg)" },
  { bg: "var(--avatar-a110-bg)", fg: "var(--avatar-a110-fg)" },
  { bg: "var(--avatar-a120-bg)", fg: "var(--avatar-a120-fg)" },
  { bg: "var(--avatar-a130-bg)", fg: "var(--avatar-a130-fg)" },
  { bg: "var(--avatar-a140-bg)", fg: "var(--avatar-a140-fg)" },
  { bg: "var(--avatar-a150-bg)", fg: "var(--avatar-a150-fg)" },
  { bg: "var(--avatar-a160-bg)", fg: "var(--avatar-a160-fg)" },
  { bg: "var(--avatar-a170-bg)", fg: "var(--avatar-a170-fg)" },
  { bg: "var(--avatar-a180-bg)", fg: "var(--avatar-a180-fg)" },
  { bg: "var(--avatar-a190-bg)", fg: "var(--avatar-a190-fg)" },
  { bg: "var(--avatar-a200-bg)", fg: "var(--avatar-a200-fg)" },
  { bg: "var(--avatar-a210-bg)", fg: "var(--avatar-a210-fg)" },
];

// §3.3 hash rule: sum of charCodes of (user id, else name) % 12 — one hash
// for every surface, so a contact keeps one color across the whole app.
function pairOf(key: string) {
  let sum = 0;
  for (let i = 0; i < key.length; i++) sum += key.charCodeAt(i);
  return AVATAR_PAIRS[sum % AVATAR_PAIRS.length];
}

// The foreground half alone, for text tinted to match a person's avatar:
// group-bubble author names and reply-quote accents (MessageBubble, ChatPane).
export function avatarFgColor(hashKey: string): string {
  return pairOf(hashKey).fg;
}

// "Alice Chen" -> "AC", "bob" -> "B" (first word + last word, uppercased).
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.[0] ?? "?";
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export default function Avatar({
  name,
  size = 48,
  hashKey,
}: {
  name: string;
  size?: number; // 28 header/runs, 32 chat header + tiles, 48 rows, 80 hero
  hashKey?: string; // stable id when the caller has one; falls back to name
}) {
  const pair = pairOf(hashKey ?? name);
  return (
    <span
      className={styles.avatar}
      style={{
        width: size,
        height: size,
        // §3.3 initials size: size * 0.42 rounded (48→20, 32→13, 28→12).
        fontSize: Math.round(size * 0.42),
        background: pair.bg,
        color: pair.fg,
      }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
