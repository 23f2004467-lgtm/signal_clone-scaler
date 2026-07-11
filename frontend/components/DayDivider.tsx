import styles from "./DayDivider.module.css";

// Day divider chip (DESIGN.md §3.5): the shadowed pill used for ALL dividers
// in the timeline — `Today`, `Yesterday`, a weekday name, or `Feb 12, 2026`.
// The label is formatted by the caller (shared timestamp util, M4 step 6).

interface Props {
  label: string;
}

export default function DayDivider({ label }: Props) {
  return (
    <div className={styles.row} role="separator" aria-label={label}>
      <span className={styles.chip}>{label}</span>
    </div>
  );
}
