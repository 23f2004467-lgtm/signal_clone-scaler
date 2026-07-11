import styles from "./TypingIndicator.module.css";

// Three-dot typing indicator (DESIGN.md §3.9). Default: a normal incoming
// bubble (incoming bg, 18px radius, 12px/8px padding) holding a 16px-tall row
// of three 6px dots pulsing on Signal's verified 1600ms ease cycle
// (peak at 20%, rest from 40%), staggered 0/160/320ms.
//
// `bare` — Signal's typing-animation-bare: just the dots, opacity-only (no
// scale), for the conversation-list preview row (DESIGN.md §3.2).
//
// Purely decorative to assistive tech; the host row/subtitle carries the
// "typing…" semantics.

interface Props {
  bare?: boolean;
}

export default function TypingIndicator({ bare = false }: Props) {
  const dots = (
    <span className={bare ? styles.dotsBare : styles.dots} aria-hidden="true">
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </span>
  );

  if (bare) return dots;

  return <div className={styles.bubble}>{dots}</div>;
}
