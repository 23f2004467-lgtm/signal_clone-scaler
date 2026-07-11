import styles from "./EmptyState.module.css";

// Right-pane empty state, no chat selected (DESIGN.md §3.12): 96px Signal
// glyph (simple circle-with-tail outline, per spec an acceptable stand-in for
// the speech-bubble mark), `Welcome to Signal` heading, a "what's new" link
// line, and the nonprofit footer pinned to the bottom. No "select a
// conversation" copy, no illustrations. Rendered on ≥641px whenever
// selectedConversationId is null — never a blank div.

export default function EmptyState() {
  return (
    <div className={styles.pane}>
      <div className={styles.center}>
        {/* Signal speech-bubble mark, tinted --color-logo (#3b45fd / #fff). */}
        <svg
          className={styles.logo}
          width="96"
          height="96"
          viewBox="0 0 96 96"
          fill="none"
          aria-hidden="true"
        >
          <g
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="48" cy="44" r="33.5" />
            {/* tail, lower-left */}
            <path d="M24.5 68 L15.5 85.5 L37 77" />
          </g>
        </svg>
        <h2 className={styles.heading}>Welcome to Signal</h2>
        <p className={styles.subline}>
          See <a className={styles.link}>what&apos;s new</a> in this update
        </p>
      </div>
      <p className={styles.footer}>Signal is a 501c3 nonprofit</p>
    </div>
  );
}
