import styles from "./StatusTicks.module.css";

// Message-status ticks (DESIGN.md §3.8). Signal Desktop uses checks inside
// circles, never bare checks, and read state is NEVER blue — the only
// delivered→read change is outline→filled. Every stroke/fill uses
// currentColor so the glyph inherits the metadata color it sits in
// (rgba(255,255,255,0.8) on outgoing bubbles, --color-icon-muted in the
// conversation-list preview).
//
// The double variants overlap two circles; the front one "erases" the rear
// through a halo disc (r 6.6) painted in --tick-halo, which the host element
// sets to its own background: outgoing bubble → --color-bubble-outgoing,
// list preview → --color-bg-secondary. Defaults to the outgoing bubble blue.
//
// Boxes are 12×12 (sending/sent) and 18×12 (delivered/read); outgoing bubbles
// should reserve 18px for the tick slot so the widening never reflows text
// (DESIGN.md §4, optimistic send).

export type TickStatus = "sending" | "sent" | "delivered" | "read";

interface Props {
  status: TickStatus;
}

const HALO = "var(--tick-halo, var(--color-bubble-outgoing, #2c6bed))";

// Single check, matched to the source messagestatus-*.svg geometry.
function Check({ dx = 0, knockout = false }: { dx?: number; knockout?: boolean }) {
  return (
    <path
      d={`M${3.6 + dx} 6.2 L${5.3 + dx} 7.9 L${8.5 + dx} 4.5`}
      fill="none"
      stroke={knockout ? HALO : "currentColor"}
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

export default function StatusTick({ status }: Props) {
  if (status === "sending") {
    // 12-dash ring: dasharray 1.4+1.45 × 12 ≈ the r=5.45 circumference →
    // exactly 12 rounded dashes. Spins via .spinner (rotate 4s linear
    // infinite — verified against Signal's --sending animation).
    return (
      <svg
        className={`${styles.tick} ${styles.spinner}`}
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <circle
          cx="6"
          cy="6"
          r="5.45"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeDasharray="1.4 1.45"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (status === "sent") {
    // Single check in an OUTLINED circle (ring spans radius 4.9→6.0).
    return (
      <svg
        className={styles.tick}
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="5.45" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <Check />
      </svg>
    );
  }

  if (status === "delivered") {
    // TWO overlapping OUTLINED circles with checks: rear at cx 6, front at
    // cx 12; the halo disc erases the rear under + just around the front,
    // leaving the hairline gap of the source icon.
    return (
      <svg
        className={styles.tick}
        width="18"
        height="12"
        viewBox="0 0 18 12"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="5.45" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <Check />
        <circle cx="12" cy="6" r="6.6" fill={HALO} />
        <circle cx="12" cy="6" r="5.45" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <Check dx={6} />
      </svg>
    );
  }

  // read — same 18×12 layout, circles FILLED (discs r 5.75) in currentColor,
  // checks knocked out in the halo/bubble color. Never tinted blue.
  return (
    <svg
      className={styles.tick}
      width="18"
      height="12"
      viewBox="0 0 18 12"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="5.75" fill="currentColor" />
      <Check knockout />
      <circle cx="12" cy="6" r="6.6" fill={HALO} />
      <circle cx="12" cy="6" r="5.75" fill="currentColor" />
      <Check dx={6} knockout />
    </svg>
  );
}
