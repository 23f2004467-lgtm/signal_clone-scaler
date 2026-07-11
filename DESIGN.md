# DESIGN.md — Signal Desktop Clone, Visual Spec (Single Source of Truth)

This document is normative. Implementation agents follow it LITERALLY. Every value is decided;
values not confirmed from Signal-Desktop source are marked `[approx]` but are still binding.

**Accent ruling:** BLUEPRINT.md M4 says `#3A76F0`. That is the 2021 Android/marketing blue. The
actual current Signal Desktop accent (verified from `stylesheets/_variables.scss`) is **#2c6bed**
(ultramarine). This spec overrides the blueprint: use **#2c6bed** everywhere. Do not use #3A76F0.

Component names referenced below match `frontend/components/` in BLUEPRINT §8:
`ConversationList.tsx`, `ChatPane.tsx`, `MessageBubble.tsx`, `Composer.tsx`, `NewChatModal.tsx`,
`NewGroupModal.tsx`, `GroupInfoPanel.tsx`, `SettingsModal.tsx`, `Avatar.tsx`, `ReconnectBanner.tsx`,
plus `app/login/page.tsx` and `app/(chat)/page.tsx`.

---

## 1. Design tokens

Paste this block verbatim into `app/globals.css` (imported by `app/layout.tsx`). Theme switching =
setting `data-theme="dark"` on `<html>`. Default (no attribute) = light.

```css
:root {
  /* ---- Gray ladder (Signal Desktop gray scale) ---- */
  --gray-02: #f6f6f6;
  --gray-04: #f0f0f0;
  --gray-05: #e9e9e9;
  --gray-15: #dedede;
  --gray-20: #c6c6c6;
  --gray-25: #b9b9b9;
  --gray-45: #848484;
  --gray-60: #5e5e5e;
  --gray-62: #545454;
  --gray-65: #4a4a4a;
  --gray-75: #3b3b3b;
  --gray-80: #2e2e2e;
  --gray-90: #1b1b1b;
  --gray-95: #121212;

  /* ---- Brand ---- */
  --ultramarine: #2c6bed;         /* THE Signal blue: outgoing bubbles, badges, focus, send */
  --ultramarine-dawn: #406ec9;    /* dark-mode unread badge */
  --ultramarine-light: #6191f3;   /* dark-mode links/accent text */
  --logo-blue: #3b45fd;           /* Signal logo glyph tint (light mode) */

  /* ---- Semantic: surfaces ---- */
  --color-bg-primary: #ffffff;             /* chat pane, message area */
  --color-bg-secondary: var(--gray-04);    /* left pane */
  --color-bg-tertiary: var(--gray-02);     /* settings nav column, inset wells [approx] */
  --color-bg-modal: #ffffff;
  --color-bg-chip: #ffffff;                /* floating day chip, scroll-to-bottom button */
  --color-border-pane: rgba(0, 0, 0, 0.16);      /* 1px divider between panes */
  --color-overlay-hover: rgba(0, 0, 0, 0.06);    /* icon-button hover, search field bg */
  --color-overlay-scrim: rgba(0, 0, 0, 0.4);     /* behind modals */

  /* ---- Semantic: text ---- */
  --color-text-primary: var(--gray-90);
  --color-text-secondary: var(--gray-60);
  --color-text-placeholder: var(--gray-45);
  --color-text-on-accent: #ffffff;
  --color-link: var(--ultramarine);

  /* ---- Semantic: conversation list ---- */
  --color-row-hover: var(--gray-05);
  --color-row-selected: var(--gray-15);
  --color-unread-badge: var(--ultramarine);
  --color-unread-badge-text: #ffffff;

  /* ---- Semantic: bubbles ---- */
  --color-bubble-outgoing: var(--ultramarine);
  --color-bubble-outgoing-text: #ffffff;
  --color-bubble-outgoing-meta: rgba(255, 255, 255, 0.8);  /* timestamp + ticks on blue */
  --color-bubble-incoming: var(--gray-05);
  --color-bubble-incoming-text: var(--gray-90);
  --color-bubble-incoming-meta: var(--gray-60);

  /* ---- Semantic: composer / inputs ---- */
  --color-input-bg: var(--gray-05);        /* identical to incoming bubble, by design */
  --color-input-focus-ring: var(--ultramarine);
  --color-icon: var(--gray-75);            /* composer/header glyphs */
  --color-icon-muted: var(--gray-45);      /* search magnifier, list ticks, bell-slash */
  --color-send-button: var(--ultramarine);

  /* ---- Semantic: misc ---- */
  --color-logo: var(--logo-blue);          /* empty-state Signal glyph */
  --color-toast-bg: var(--gray-80);
  --color-toast-text: var(--gray-05);
  --color-banner-bg: var(--gray-05);       /* ReconnectBanner [approx] */
  --color-banner-text: var(--gray-60);

  /* ---- Avatar pairs: pastel background / saturated foreground (12) ---- */
  --avatar-a100-bg: #e3e3fe; --avatar-a100-fg: #3838f5;
  --avatar-a110-bg: #dde7fc; --avatar-a110-fg: #1251d3;
  --avatar-a120-bg: #d8e8f0; --avatar-a120-fg: #086da0;
  --avatar-a130-bg: #cde4cd; --avatar-a130-fg: #067906;
  --avatar-a140-bg: #eae0fd; --avatar-a140-fg: #661aff;
  --avatar-a150-bg: #f5e3fe; --avatar-a150-fg: #9f00f0;
  --avatar-a160-bg: #f6d8ec; --avatar-a160-fg: #b8057c;
  --avatar-a170-bg: #f5d7d7; --avatar-a170-fg: #be0404;
  --avatar-a180-bg: #fef5d0; --avatar-a180-fg: #836b01;
  --avatar-a190-bg: #eae6d5; --avatar-a190-fg: #7d6f40;
  --avatar-a200-bg: #d2d2dc; --avatar-a200-fg: #4f4f6d;
  --avatar-a210-bg: #d7d7d9; --avatar-a210-fg: #5c5c5c;

  /* ---- Typography ---- */
  /* Signal's full stack ($inter) also bundles 'Source Sans Pro', 'Source Han Sans' and the
     Signal Emoji fonts; we deliberately drop the bundled fonts and keep the same order. */
  --font-family: Inter, -apple-system, system-ui, 'Segoe UI', 'Noto Sans',
                 'Helvetica Neue', Helvetica, Arial, sans-serif;
  /* Type scale: size / line-height / letter-spacing. Bold is ALWAYS weight 600, never 700. */
  --font-title-2: 600 20px/26px var(--font-family);   /* ls -0.34px — modal titles, welcome */
  --font-title-medium: 600 16px/22px var(--font-family); /* ls -0.17px [approx] — pane header */
  --font-body-1: 14px/20px var(--font-family);        /* ls -0.08px — messages, names, titles */
  --font-body-2: 13px/18px var(--font-family);        /* ls -0.03px — previews, subtitles, search */
  --font-body-small: 12px/16px var(--font-family);    /* group author names, modal subtitles */
  --font-subtitle: 12px/17px var(--font-family);      /* modal list subtitles */
  --font-caption: 11px/14px var(--font-family);       /* ls +0.06px — timestamps, badges, metadata */

  /* ---- Radii scale ---- */
  --radius-sm: 4px;      /* icon-button hover bg, flattened run corners */
  --radius-md: 8px;      /* search field, modals, banners */
  --radius-row: 10px;    /* conversation rows, unread badge */
  --radius-bubble: 18px; /* bubbles, composer input */
  --radius-full: 9999px; /* avatars, chips, pills, circular buttons */

  /* ---- Spacing scale (use these steps only) ---- */
  --space-1: 2px;  --space-2: 4px;  --space-3: 6px;  --space-4: 8px;
  --space-5: 12px; --space-6: 16px; --space-7: 20px; --space-8: 24px; --space-9: 32px;

  /* ---- Shadows ---- */
  --shadow-chip: 0 1px 4px rgba(0, 0, 0, 0.2);   /* floating day chip, scroll-to-bottom */
  --shadow-modal: 0 8px 24px rgba(0, 0, 0, 0.24); /* [approx] */
  --shadow-toast: 0 4px 12px rgba(0, 0, 0, 0.24); /* [approx] */

  /* ---- Z-index scale ---- */
  --z-sticky-date: 10;   /* floating day chip */
  --z-scroll-btn: 15;
  --z-banner: 20;        /* ReconnectBanner */
  --z-modal: 100;
  --z-toast: 200;

  /* ---- Transitions ---- */
  --transition-fast: 120ms ease-out;    /* hovers, button reveals [approx] */
  --transition-medium: 250ms ease-out;  /* chip fade (0.25s per source), pane slide */
  --duration-typing: 1600ms;            /* typing dot cycle (verified: 1600ms ease) */
  --duration-typing-stagger: 160ms;     /* per-dot delay (verified: 0/160ms/320ms) */
  --duration-spinner: 4s;               /* sending-tick rotation (verified: rotate 4s linear infinite) */

  /* ---- Breakpoints (DESIGN_BRIEF contract) ----
     @media rules must hardcode the same px (custom properties don't work in media queries);
     these tokens are the single documented source + what JS matchMedia mirrors. */
  --bp-mobile: 640px;   /* ≤640px = single-pane phone layout */
  --bp-tablet: 1024px;  /* 641–1024px = tablet two-pane; >1024px = desktop */
}

[data-theme="dark"] {
  --color-bg-primary: var(--gray-95);        /* #121212 chat pane */
  --color-bg-secondary: var(--gray-80);      /* #2e2e2e left pane */
  --color-bg-tertiary: var(--gray-90);       /* [approx] */
  --color-bg-modal: var(--gray-80);
  --color-bg-chip: var(--gray-80);
  --color-border-pane: rgba(255, 255, 255, 0.16);
  --color-overlay-hover: rgba(255, 255, 255, 0.06);
  --color-overlay-scrim: rgba(0, 0, 0, 0.6);

  --color-text-primary: var(--gray-05);      /* #e9e9e9 */
  --color-text-secondary: var(--gray-25);    /* #b9b9b9 */
  --color-text-placeholder: var(--gray-25);
  --color-link: var(--ultramarine-light);

  --color-row-hover: var(--gray-75);         /* #3b3b3b */
  --color-row-selected: var(--gray-65);      /* #4a4a4a */
  --color-unread-badge: var(--ultramarine-dawn); /* #406ec9 */

  --color-bubble-outgoing: var(--ultramarine);   /* SAME blue in dark mode */
  --color-bubble-outgoing-text: var(--gray-05);  /* #e9e9e9 */
  --color-bubble-incoming: var(--gray-75);       /* #3b3b3b */
  --color-bubble-incoming-text: var(--gray-05);
  --color-bubble-incoming-meta: var(--gray-25);

  --color-input-bg: var(--gray-75);
  --color-icon: var(--gray-15);              /* #dedede */
  --color-icon-muted: var(--gray-25);

  --color-logo: #ffffff;
  --color-toast-bg: var(--gray-65);          /* [approx] */
  --color-toast-text: var(--gray-05);
  --color-banner-bg: var(--gray-75);
  --color-banner-text: var(--gray-25);
}

/* Search field bg is an rgba overlay, different per theme and NOT the hover token in dark: */
:root { --color-search-bg: rgba(0, 0, 0, 0.06); }
[data-theme="dark"] { --color-search-bg: rgba(255, 255, 255, 0.12); }

body {
  font: var(--font-body-1);
  letter-spacing: -0.08px;
  color: var(--color-text-primary);
  background: var(--color-bg-secondary);
  -webkit-font-smoothing: antialiased;
}

/* Scrollbars (WebKit): 9px, thumb gray-20/gray-62 [approx thumb colors] */
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: var(--gray-20); border-radius: var(--radius-full); }
[data-theme="dark"] ::-webkit-scrollbar-thumb { background: var(--gray-62); }
::-webkit-scrollbar-track { background: transparent; }
```

---

## 2. Layout skeleton

Two-pane app shell (we deliberately omit Signal's 80px NavTabs rail — this is the classic
recognizable pre-rail layout; the user's own avatar goes in the left-pane header instead).

```
app/(chat)/page.tsx
┌─────────────────────┬──────────────────────────────────────┐
│ ConversationList    │ ChatPane (or EmptyState)             │
│ width: 320px fixed  │ flex: 1                              │
│ bg: --color-bg-     │ bg: --color-bg-primary               │
│     secondary       │                                      │
│                     │ ┌ header 52px ─────────────────────┐ │
│ ┌ header 52px ────┐ │ ├ message scroll (flex:1) ─────────┤ │
│ ├ search row ─────┤ │ └ composer min-height 42px ────────┘ │
│ └ rows (scroll) ──┘ │                                      │
└─────────────────────┴──────────────────────────────────────┘
```

- Grid: `display: grid; grid-template-columns: 320px 1fr; height: 100dvh;`
- Pane divider: ConversationList gets `border-right: 1px solid var(--color-border-pane)`.
  No other border between panes. ChatPane header has **no** border-bottom.
- Left pane width: **320px fixed** (Signal default; resizable 280–380px is optional bonus — if
  implemented, clamp to [280, 380]).
- Header heights: left-pane header **52px**, chat header **52px** (align across panes).
- Composer: container **min-height 42px**, grows with input up to input max-height 72px.
- Message scroll region: `overflow-y: auto; position: relative;` (for sticky date chip and
  scroll-to-bottom button).

**Responsive rule (breakpoint 640px):**
```css
@media (max-width: 640px) {
  /* single pane: show list OR chat, never both */
  .app-shell { grid-template-columns: 1fr; }
}
```
- State: `selectedConversationId === null` → render ConversationList full-width;
  non-null → render ChatPane full-width.
- ChatPane header gains a back-chevron button (20px glyph, same 32×32 icon-button style,
  leftmost, 4px margin-right) that sets `selectedConversationId = null`.
- Transition: none required; instant swap is acceptable. Optional 250ms translateX slide [approx].
- On ≥641px, selecting nothing shows the EmptyState in the right pane (never a blank div).

**Mobile/touch hardening (DESIGN_BRIEF contract — all binding, no decisions open):**
1. **Inputs ≥16px on phones:** at `max-width: 640px`, the search field and composer input bump
   `font-size` to **16px** (line-height 22px); placeholders scale with them. Everything else
   keeps the desktop type scale. (Prevents iOS Safari focus auto-zoom; desktop stays 13/14px.)
2. **Tap targets ≥44×44px:** under `(pointer: coarse)`, every icon button keeps its 20px glyph
   and 32px visual box but gains a transparent hit area extended to 44×44
   (`::after { position:absolute; inset:-6px; }`). Conversation rows (72px) already comply.
3. **Hover guards:** every hover-only affordance (row hover tints, icon-button hover bg,
   message action bar §4) is wrapped in `@media (hover: hover)`. On touch there is no hidden
   information: timestamps + ticks are always visible in-bubble; reply is reachable via
   long-press if built, otherwise cut on touch (documented limitation).
4. **Scroll containment:** the message scroll region gets `overscroll-behavior: contain`;
   it is the ONLY scrollable element in the chat view — the page never scrolls.
5. **Safe areas:** composer adds `padding-bottom: env(safe-area-inset-bottom)`; the app shell
   adds `padding-left/right: env(safe-area-inset-left/right)`; headers add
   `padding-top: env(safe-area-inset-top)` when running standalone [approx placement].
6. **Reduced motion:** under `(prefers-reduced-motion: reduce)` — typing dots render static at
   opacity 0.7 (no scale/opacity animation), pane slide and chip fades become instant,
   send-button reveal drops the scale (opacity only), smooth-scroll becomes `auto`.
   The sending spinner keeps rotating (status information, not decoration) [approx ruling].

---

## 3. Component specs

### 3.1 ConversationList — top bar + search (`ConversationList.tsx`)

**Header row** (52px tall, padding 0 16px, flex, align-center):
1. Own avatar, **28px**, leftmost, opens SettingsModal on click. Margin-right 8px.
2. Title `Chats` — `--font-title-medium`, weight 600, color `--color-text-primary`, flex-grow.
3. New-chat button: pencil/compose icon **20px glyph**, color `#3b3b3b` light / `#dedede` dark
   (`--color-icon`), inside a button with **4px padding, border-radius 4px**; hover bg
   `--color-overlay-hover`. Tooltip/aria-label exactly `New chat`. Opens the new-chat takeover (§3.15).
4. `⋮` more button, same style, 4px margin-left. Menu items: `Settings`, `Toggle theme` [approx].

**Search row:** margin: 0 16px 8px 16px.
- Input: height **28px**, border-radius **8px** (rounded rect, NOT a pill), background
  `--color-search-bg`, border 1px transparent; keyboard focus → border 1px `--ultramarine`.
- Font 13px (`--font-body-2`); padding-inline **30px 5px**; placeholder exactly `Search`,
  color `--color-text-placeholder`.
- Magnifier icon 16×16, absolutely positioned left 8px / top 6px, color `--color-icon-muted`.
- Behavior: client-side filter of the fetched conversation list (name match, case-insensitive).

**Rows container:** `padding-inline: 11px; overflow-y: auto;`

### 3.2 Conversation row (in `ConversationList.tsx`)

Full-width `<button>`, height **72px**, border-radius **10px**, margin-block **2px**,
padding **8px 14px**, text-align left, cursor pointer, display flex, align-center.

- **Avatar**: 48px (§3.3), margin-right **12px**.
- **Text block** (flex column, flex 1, min-width 0):
  - Row 1 (flex, align-center): name — 14px/20px **600**, `--color-text-primary`, ellipsis,
    flex-grow. Optional muted bell-slash icon 14px `--color-icon-muted` with 8px left margin.
    Timestamp far right — 11px/14px, letter-spacing 0.06px, `--color-text-secondary`,
    margin-left 6px, flex-shrink 0.
  - Row 2 (flex, align-center): preview — 13px/18px, `--color-text-secondary`,
    `-webkit-line-clamp: 2` (max 2 lines; single line is fine for the clone [approx]).
    If the last message is your own, prefix the preview with a status tick (§3.8) 12px wide
    (18px for double variants) in `--color-icon-muted`, 4px gap. When the peer is typing, replace
    the preview with three static-size 6px dots animating opacity only (no scale) — Signal's
    `typing-animation-bare` variant — same colors/timing as §3.9.
  - Unread badge at the far right of row 2: margin-inline-start 10px.
- **Unread badge**: pill — height **18px**, min-width **18px**, border-radius **10px**,
  background `--color-unread-badge`, count text 11px weight 500 `#ffffff`, padding-inline 4px,
  centered. Counts >99 render `99+` [approx]. **Do NOT bold name or preview when unread** —
  the badge alone signals unread.

**States** (background only; no left accent bar, no elevation):
| State | Light | Dark |
|---|---|---|
| default | transparent | transparent |
| hover | `#e9e9e9` (`--color-row-hover`) | `#3b3b3b` |
| selected | `#dedede` (`--color-row-selected`) | `#4a4a4a` |
| selected+hover | selected color wins | selected color wins |

**Timestamp format** (shared util, used in list AND bubbles):
`<1 min` → `Now`; `<1 h` → `{n}m`; same day → clock time `9:41 AM`; within past 7 days →
short weekday `Mon`; `<6 months` → `Mar 5`; older → `Mar 5, 2025`.

### 3.3 Avatar (`Avatar.tsx`)

- Perfect circle: `border-radius: 100%`. No border, no ring.
- Sizes (prop `size`): **48** list rows, **32** chat header + modal contact rows, **28** own
  avatar in left-pane header and group-run bubbles, **80** GroupInfoPanel hero [approx].
- **Initials rule:** first letter of first word + first letter of last word, uppercased
  (single word → first letter only). Font: weight 600, size = `size * 0.42` rounded [approx]
  (48→20px, 32→13px, 28→12px), centered.
- **Color-hash rule:** `hash = sum of charCodes of (user id, else name)` → `pairIndex = hash % 12`
  into the ordered pair list A100…A210 (tokens §1). Background = pastel `-bg`, initials color =
  saturated `-fg`. **Never white text on saturated bg** — Signal uses pastel bg + saturated fg.
- Group avatars: same rule hashed on group id; initials from group name.

### 3.4 ChatPane header (`ChatPane.tsx`)

Height **52px**, background = chat pane bg (`--color-bg-primary`), **no border-bottom**,
padding-block 4px, padding-inline 12px, margin-inline 4px, flex align-center.

- (≤640px only) back chevron icon-button, leftmost.
- Avatar **32px**, margin-right **12px**.
- Title block (flex column): name 14px/20px **600** `--color-text-primary`. Subtitle 13px/18px
  `--color-text-secondary`: for DMs `online` / `last seen {time}` (clone invention in Signal's
  exact subtitle style — real Signal shows no presence); for groups `{n} members`.
  While peer types: subtitle becomes `typing…` [approx].
- Right side, circular icon buttons — 20px glyphs, **6px padding (32px hit target)**,
  `border-radius: 9999px`, hover bg `--color-overlay-hover`, color `--color-icon`.
  Order left→right: `[video]` `[phone — DMs only]` `[search-in-chat]` `[⋮]`.
  Video/phone/search open a `Coming Soon` toast (§3.14). `⋮` menu: `Group info` (groups),
  `Coming Soon` items otherwise.

### 3.5 Message area + day dividers (`ChatPane.tsx`)

- Background: plain `--color-bg-primary` (#ffffff / #121212). **No wallpaper, no pattern.**
- Timeline horizontal padding: **16px** each side.
- **Day dividers — use the chip style for ALL dividers** (ruling; instantly reads as Signal):
  centered pill, padding **10px horizontal / 6px vertical**, `border-radius: 9999px`,
  background `--color-bg-chip` (#fff / #2e2e2e), `box-shadow: var(--shadow-chip)`,
  text 13px weight 500 `--color-text-secondary`. Label: `Today`, `Yesterday`, weekday name
  (within 7 days), else `Feb 12, 2026`. Wrapped in a full-width flex row, justify-center,
  margin-block 20px 8px [approx].
- **Sticky floating chip:** while scrolling, the current day's chip clones to
  `position: sticky/absolute; top: 10px; z-index: var(--z-sticky-date)`, fading in/out over
  **250ms**. If timeboxed, static chips alone are acceptable; sticky is bonus.

### 3.6 MessageBubble (`MessageBubble.tsx`)

**Row:** flex; incoming justify-start, outgoing justify-end. Vertical margin **6px** top+bottom
normally, **1px** between messages inside a run.

**Bubble box:**
- Padding **12px horizontal / 8px vertical**.
- Border-radius **18px** all corners (Signal has **no tails, ever**).
- Max-width (verified, `_modules.scss` container-outer): pane ≤514px →
  `min(306px, calc(100% - 38px))`; 515–606px → `370px`; >606px → `50vw`.
  Implement literally with a container query or JS on pane width; if timeboxed, `min(50vw, 480px)`
  above 640px viewport and `min(306px, 100% - 38px)` below [approx simplification].
- Text: 14px/20px, letter-spacing −0.08px. Links underlined, same color as surrounding text.
- Colors:
  | | Light | Dark |
  |---|---|---|
  | Outgoing bg | `#2c6bed` | `#2c6bed` (same) |
  | Outgoing text | `#ffffff` | `#e9e9e9` |
  | Incoming bg | `#e9e9e9` | `#3b3b3b` |
  | Incoming text | `#1b1b1b` | `#e9e9e9` |

**Consecutive-run grouping** (verified, `ts/util/timelineUtil.std.ts` `COLLAPSE_WITHIN = 3 * MINUTE`).
Messages collapse into a run when: same author AND <**3 minutes** apart AND same calendar day
AND the older message has no reactions. (Source adds "no unread indicator between them" —
if the clone ever renders an unread divider, it also breaks the run.)
- Inside a run: vertical gaps shrink 6px → **1px**.
- Corner flattening, **sender side only**, flattened corners go 18px → **4px**:
  - Incoming, collapsed-above (not first of run): `border-top-left-radius: 4px`.
  - Incoming, collapsed-below (not last of run): `border-bottom-left-radius: 4px`.
  - Outgoing: mirrored — top-right / bottom-right.
  - Middle-of-run messages get both flattened corners.

**Group chats only** (DMs never show per-message avatars):
- Incoming rows get a left avatar column: min-width **28px**, margin-right **8px**,
  bottom-aligned (`align-self: flex-end`) with padding-bottom 6px. Render the 28px avatar ONLY
  on the **last** message of a run; other rows keep an empty 28px spacer for alignment.
- Author name inside the bubble, top of the **first** message of a run only: 12px/16px
  weight 600, margin-bottom 3px, colored with the author's avatar `-fg` color (§3.3 hash).

**Metadata row — INSIDE the bubble, bottom-right:**
- Flex row, `justify-content: flex-end`, margin-top **3px**, font 11px/14px letter-spacing
  0.06px, `user-select: none`.
- Color: `--color-bubble-outgoing-meta` (rgba(255,255,255,0.8)) on outgoing;
  `--color-bubble-incoming-meta` on incoming.
- Order: `[edited]` label (if ever) → timestamp (`Now` / `5m` / clock) → status icon.
- Incoming bubbles: **timestamp only, no ticks.**
- Status icon box: 12×12 (18×12 for double variants), margin-inline 6px 0, margin-bottom 2px.
- Optional polish: when the last text line is short, float metadata beside it
  (`float: inline-end; margin-top: -14px`); otherwise the plain flex row is acceptable.

### 3.7 Reply/quote block (inside `MessageBubble.tsx`) `[approx — styled to Signal's quote pattern]`

Rendered at the top of the bubble, above the text, when `reply_to_id` is set:
- Full-width block: border-radius **10px**, padding **8px**, margin-bottom **6px**.
- Left accent bar: 4px wide, full height, `border-radius 4px`, color = quoted author's avatar
  `-fg` color (own messages quoted → `--ultramarine`).
- Background: on incoming bubbles `rgba(0,0,0,0.06)` light / `rgba(255,255,255,0.08)` dark;
  on outgoing bubbles `rgba(255,255,255,0.15)` both themes.
- Content: author name 12px/16px 600 (accent-bar color on incoming; white on outgoing),
  then quoted text 13px/18px, 1-line ellipsis, inheriting bubble text color at 0.9 opacity.
- Clicking the quote scrolls to the original message [approx, optional].

### 3.8 Tick glyphs (in `MessageBubble.tsx` — render as inline SVG components)

Signal Desktop uses **checks inside circles**, never bare checks, and read state is **never
blue** — the only delivered→read change is outline→filled. All glyphs use `currentColor`
(inherits metadata color, i.e. rgba(255,255,255,0.8) on outgoing bubbles). Geometry below is
matched to the verified source icons `images/icons/v3/message_status/messagestatus-{sending,
sent,delivered,read}.svg`: sending = 12-segment dashed ring; sent/delivered rings span
radius 4.9→6.0 (stroke circle r 5.45, width 1.1); read discs are radius **5.75**, filled.

Create one `<StatusTick status={...}/>` component with these four SVGs:

1. **sending** — 12×12 dashed-ring spinner (source: 12 short rounded dashes around the circle):
   ```svg
   <svg width="12" height="12" viewBox="0 0 12 12">
     <circle cx="6" cy="6" r="5.45" fill="none" stroke="currentColor"
             stroke-width="1.1" stroke-dasharray="1.4 1.45" stroke-linecap="round"/>
   </svg>
   ```
   (dasharray 1.4+1.45 × 12 ≈ the r=5.45 circumference → exactly 12 dashes.)
   CSS: `animation: tick-rotate var(--duration-spinner) linear infinite;` with
   `@keyframes tick-rotate { to { transform: rotate(360deg); } }` — verified: Signal animates
   `--sending` with `rotate 4s linear infinite`.

2. **sent** — 12×12 single check in an OUTLINED circle:
   ```svg
   <svg width="12" height="12" viewBox="0 0 12 12">
     <circle cx="6" cy="6" r="5.45" fill="none" stroke="currentColor" stroke-width="1.1"/>
     <path d="M3.6 6.2 L5.3 7.9 L8.5 4.5" fill="none" stroke="currentColor"
           stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
   </svg>
   ```

3. **delivered** — 18×12 TWO overlapping OUTLINED circles with checks (rear circle at cx 6,
   front at cx 12; front occludes the rear via a bubble-colored halo leaving a hairline gap):
   ```svg
   <svg width="18" height="12" viewBox="0 0 18 12">
     <!-- rear circle (left), clipped where the front overlaps -->
     <circle cx="6" cy="6" r="5.45" fill="none" stroke="currentColor" stroke-width="1.1"/>
     <path d="M3.6 6.2 L5.3 7.9 L8.5 4.5" fill="none" stroke="currentColor"
           stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
     <!-- halo: erase the rear circle under+just around the front one; var set to bubble bg.
          r 6.6 [approx] = front outer edge 6.0 + hairline gap, as in the source icon -->
     <circle cx="12" cy="6" r="6.6" fill="var(--tick-halo, var(--color-bubble-outgoing))"/>
     <!-- front circle (right) -->
     <circle cx="12" cy="6" r="5.45" fill="none" stroke="currentColor" stroke-width="1.1"/>
     <path d="M9.6 6.2 L11.3 7.9 L14.5 4.5" fill="none" stroke="currentColor"
           stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
   </svg>
   ```
   Set `--tick-halo` on the bubble: outgoing → `--color-bubble-outgoing`; conversation-list
   preview → `--color-bg-secondary` (and row hover/selected states may show a slightly wrong
   halo — acceptable).

4. **read** — same 18×12 layout, circles **FILLED** discs r 5.75 in `currentColor`, checks
   knocked out (stroke = the halo/bubble color):
   ```svg
   <svg width="18" height="12" viewBox="0 0 18 12">
     <circle cx="6" cy="6" r="5.75" fill="currentColor"/>
     <path d="M3.6 6.2 L5.3 7.9 L8.5 4.5" fill="none"
           stroke="var(--tick-halo, var(--color-bubble-outgoing))"
           stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
     <circle cx="12" cy="6" r="6.6" fill="var(--tick-halo, var(--color-bubble-outgoing))"/>
     <circle cx="12" cy="6" r="5.75" fill="currentColor"/>
     <path d="M9.6 6.2 L11.3 7.9 L14.5 4.5" fill="none"
           stroke="var(--tick-halo, var(--color-bubble-outgoing))"
           stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
   </svg>
   ```
   **Never tint read ticks blue.** The BLUEPRINT's "✓✓ blue" line is overridden by this spec.

### 3.9 Typing indicator (in `ChatPane.tsx` timeline)

Rendered as a normal **incoming bubble** (incoming bg, 18px radius, 12px/8px padding) whose
content is a 16px-tall row of three dots:
- Dots: three circles, **6px** diameter, gap 6px (total row ≈ 30px wide), color
  `#5e5e5e` light / `#ffffff` dark, base opacity 0.4.
- Animation per dot: `typing-dot var(--duration-typing) ease infinite` where (verified —
  Signal's `typing-animation` keyframes, 1600ms ease)
  `@keyframes typing-dot { 0% { opacity: .4; transform: scale(1); } 20% { opacity: 1; transform: scale(1.3); } 40%, 100% { opacity: .4; transform: scale(1); } }`
  — i.e. the pulse happens in the first 40% of the cycle, then rests.
- Stagger (verified): dot 1 `animation-delay: 0ms`, dot 2 `160ms`, dot 3 `320ms`.
- List-preview variant (§3.2) = Signal's `typing-animation-bare`: identical keyframe stops but
  opacity only, no scale.
- In group chats, pair with the 28px avatar column like any incoming run-end message.
- Appears/disappears without shifting scroll if user is at bottom (auto-scroll keeps it visible).

### 3.10 Composer (`Composer.tsx`)

Container: min-height **42px**, padding-block **10px**, background transparent (sits on the chat
bg). Flex row, align-end. Cells have 4px inline margins; 12px at the outer edges.
(Resting height computes to 52px — 32px input + 2×10px padding; the 42px min-height is a floor,
not the target.) On phones add `padding-bottom: env(safe-area-inset-bottom)` and bump the input
font to 16px (§2 mobile hardening).

Order left→right:
1. **Emoji button** — 20px smiley glyph, 32×32 transparent button, color `--color-icon`,
   hover bg `--color-overlay-hover`, rounded-full. Action: `Coming Soon` toast (or a minimal
   emoji strip if reactions are built).
2. **Input** — flex-grow, 6px inline margins. Border-radius **18px**, background
   `--color-input-bg` (identical to incoming bubble, by design), border 1px transparent
   (keyboard focus → 1px `--ultramarine`). Text 14px/20px; placeholder `Message`, color
   `--color-text-placeholder`. Inner padding **6px block / 12px inline**. `contenteditable` or
   auto-growing `<textarea>`: content min-height **32px**, max-height **72px** (~3 lines) then
   scrolls internally. Disabled (socket down): opacity 0.5, placeholder `Waiting to reconnect…` [approx].
3. **Send/mic slot** — when input is empty: mic glyph button (same 32×32 ghost style; click →
   `Coming Soon` toast). The moment text is non-empty, it is REPLACED by the **send button**:
   **32px circular**, background `--color-send-button` (#2c6bed), white paper-plane `send-fill`
   glyph 20px, 6px padding, rounded-full. Reveal: 120ms opacity+scale(0.8→1) [approx].
   (Truth note: real Signal compact composer has no send button — Enter sends; this styling
   matches main's 32px primary circle and satisfies the assignment.)
4. **Attach button** — paperclip 20px glyph `#3b3b3b` light / `#dedede` dark, 32×32 ghost
   button, rightmost. Click → `Coming Soon` toast (attachments are cut).

Reply state: when replying, a quote preview bar renders ABOVE the composer row — same quote
block styling as §3.7 on a `--color-input-bg` strip, radius 10px, with a 20px × close button
right-aligned; Esc also cancels [approx].

### 3.11 Reactions row `[approx — Signal-flavored]`

- Attached below-outside the bubble, overlapping its bottom edge by **8px**
  (`margin-top: -8px`, aligned to the bubble's inner edge: left for incoming, right for outgoing).
- Pill: height **22px**, border-radius 9999px, padding 2px 6px, background `--color-bg-chip`,
  border 1.5px solid `--color-bg-primary` (cutout effect), shadow `0 0 2px rgba(0,0,0,0.2)`.
- Content: emoji 12px + count 11px `--color-text-secondary` (count hidden when 1).
  Multiple distinct emoji collapse into one pill: up to 3 emoji then total count.
- Trigger: hover action bar (§4) or double-click bubble → a horizontal picker pill with
  ❤️ 👍 👎 😂 😮 😢 (Signal's default 6), 32px cells, same chip bg + `--shadow-chip`.
- A message with reactions never collapses with the message after it (grouping rule §3.6).

### 3.12 Empty state (right pane, no chat selected) (`ChatPane.tsx` or inline in `page.tsx`)

Centered flex column on `--color-bg-primary`:
1. Signal glyph logo **96×96** (inline SVG of the Signal speech-bubble mark; a simple
   circle-with-tail outline in the right tint is acceptable), tinted `--color-logo`
   (#3b45fd light / #ffffff dark).
2. Heading `Welcome to Signal` — `--font-title-medium` 600, margin 20px top / 6px bottom.
3. Secondary line 13px `--color-text-secondary`: `See what's new in this update` with
   "what's new" as a link (`--color-link`, no-op or README link).
4. Pinned at the very bottom (16px from edge): small text 12px `--color-text-secondary`:
   `Signal is a 501c3 nonprofit`.
No "select a conversation" copy, no illustrations.

### 3.13 ReconnectBanner (`ReconnectBanner.tsx`) `[approx]`

- Position: full-width strip at the very top of the app shell (above both panes),
  `z-index: var(--z-banner)`; panes shift down (no overlay).
- Height 32px, background `--color-banner-bg`, text 13px `--color-banner-text`, centered:
  spinner (12px, reuse the sending-tick spinner SVG) + `Reconnecting…`; after reconnect show
  `Connected` in the same style for 1.5s then slide away 250ms.
- Composer is disabled while the banner shows (§3.10).

### 3.14 Toasts `[approx]`

- Fixed, bottom-center, 24px from bottom, `z-index: var(--z-toast)`.
- Pill: background `--color-toast-bg`, text `--color-toast-text` 13px, padding 8px 12px,
  border-radius 8px, `--shadow-toast`, max-width 320px.
- Enter/exit: 120ms fade+8px translateY. Auto-dismiss 3s. One at a time (replace).
- Standard copy: `Coming Soon` features use exactly `Coming Soon` as the toast text.

### 3.15 New chat — left-pane takeover (`NewChatModal.tsx`)

Real Signal's compose flow replaces the LEFT PANE, it is not a floating modal. Keep the
component name but render it as a takeover of the left pane:
- Header (52px): back-arrow icon-button (20px glyph) + title `New chat`
  (`--font-title-medium` 600).
- Search row: identical to §3.1 (`Find by name` placeholder [approx]).
- Below: contact rows in the **ListTile** pattern — 32px avatar, padding-block **8px**,
  padding-inline **16px**, title 14px/20px, subtitle 12px/17px `--color-text-secondary`
  (phone number), hover `--color-overlay-hover`, cursor pointer. Full-width, no radius [approx].
- Top of list, before contacts: a `New group` row (icon-tile 32px in `--color-overlay-hover`
  bg with a group glyph) that opens NewGroupModal's step 1; and `Note to Self` row [approx].
- Clicking a contact creates/opens the DM and restores the normal list. Esc or back restores.

### 3.16 NewGroupModal — two-step (`NewGroupModal.tsx`)

Also a left-pane takeover (matching real Signal), two steps:
- **Step 1 — Choose members:** header `Add members` + back arrow; search row; contact ListTiles
  (§3.15) each with a 20px round checkbox on the right (checked = `--ultramarine` fill, white
  check). Selected members render as removable chips (24px pill: 20px avatar + name 13px + ×)
  in a wrap row under the search field [approx]. Bottom-pinned primary button `Next`
  (see button spec below), disabled until ≥1 selected.
- **Step 2 — Name group:** header `Name this group` + back arrow; centered 64px group avatar
  placeholder (camera glyph on `--color-overlay-hover` circle) [approx]; text input styled like
  the composer input (18px radius, `--color-input-bg`), placeholder `Group name (required)`;
  member chips summary; bottom-pinned primary button `Create`, disabled until named.
- **Primary button spec (shared):** height 36px, border-radius 9999px, background
  `--ultramarine`, white 14px 600 text, padding-inline 24px, full-width with 16px margins,
  hover: 8% white overlay; disabled: 40% opacity [approx].

### 3.17 GroupInfoPanel (`GroupInfoPanel.tsx`) `[approx layout, Signal-styled tokens]`

Right-side overlay panel: width **320px**, full height, background `--color-bg-secondary`,
`border-left: 1px solid var(--color-border-pane)`, slides in 250ms from right,
`z-index: var(--z-banner)`.
- Header 52px: × close icon-button (20px) + title `Group info` (`--font-title-medium`).
- Hero: centered 80px group avatar, group name 20px/26px 600, `{n} members` 13px secondary.
- Section header `{n} members` 13px 600 `--color-text-secondary`, padding 16px 16px 4px.
- Member ListTiles (§3.15 pattern, 32px avatars): name + `Admin` badge where applicable
  (11px, padding 2px 6px, radius 4px, bg `--color-overlay-hover`, secondary text color).
  Hover reveals a `⋮` per-row button (admins only): `Remove from group`, `Make admin`.
- `Add members` row at top of the member list: 32px round `--color-overlay-hover` tile with a
  `+` glyph, label in `--color-link`.
- Rename: pencil icon-button beside the group name (admins), inline input on click.

### 3.18 SettingsModal (`SettingsModal.tsx`)

True centered modal: scrim `--color-overlay-scrim`; card border-radius **8px**, background
`--color-bg-modal` (#ffffff / #2e2e2e), padding **16px**, `--shadow-modal`, width 640px
max-width 90vw, height 480px max-height 85vh [approx dimensions].
- Title row: `Settings` (`--font-title-2` 20px 600) + × close icon-button **20px** top-right.
- Two columns: left nav **200px** [approx] on `--color-bg-tertiary`, radius 8px; items =
  ListTile-style rows (36px tall, radius 8px, 14px text, icon 20px, selected bg
  `--color-row-selected`, hover `--color-overlay-hover`):
  `Profile`, `Appearance`, `Chats`, `Privacy`, `Notifications`.
- **Appearance (fully working):** section title `Theme` 14px 600; radio group with three
  options `System` / `Light` / `Dark` (20px radio circles, selected = ultramarine dot).
  Selecting writes `data-theme` on `<html>` immediately and persists to `localStorage`
  (`theme` key). `System` follows `prefers-color-scheme`.
- **Profile:** own 80px avatar + name + phone, read-only.
- **All other sections:** placeholder — centered 13px `--color-text-secondary` text
  `Coming Soon` with a 32px lock or bell glyph above [approx].
- Esc and scrim-click close.

### 3.19 "End-to-end encrypted" chat-start notice (in `ChatPane.tsx`)

At the very top of every conversation's timeline (before the first day chip):
- Centered block, max-width 300px, padding 16px, text-align center.
- Lock glyph 16px inline before text, `--color-text-secondary`.
- Text 13px/18px `--color-text-secondary`:
  `Messages are end-to-end encrypted. No one outside of this chat, not even Signal, can read them.` [approx wording — Signal-style]
- No background chip, no border. (This is the mock-encryption banner from BLUEPRINT §10.)

### 3.20 Login / onboarding (`app/login/page.tsx`)

Signal-flavored staged card:
- Full-viewport background `--color-bg-secondary`; centered card: max-width **360px**,
  border-radius 8px, background `--color-bg-modal`, padding 32px, `--shadow-modal` [approx].
- **Logo lockup** top-center: Signal glyph 48px tinted `--color-logo` + wordmark `Signal`
  20px/26px 600 beneath, then a 13px secondary caption `Fast, simple, secure clone` [approx].
- **Stage 1 — phone:** label `Phone number` 12px 600 secondary; input styled like the composer
  input but rectangular-ish (radius 8px, height 36px, `--color-input-bg`, focus ring
  ultramarine); primary pill button `Next` (§3.16 button spec).
- **Stage 2 — OTP:** helper text 13px secondary `Enter the code we sent to {phone}` and
  `(demo code: 123456)`; 6-digit input; primary button `Verify`. Back link 13px `--color-link`.
- Stage transition: 250ms fade/slide [approx].
- Below the card: one-click demo buttons `Login as Alice` / `Login as Bob` — ghost pills
  (radius 9999px, 1px solid `--color-border-pane`, 13px, hover `--color-overlay-hover`).
- Footer, bottom of viewport: `Signal is a 501c3 nonprofit` 12px secondary.

---

## 4. Micro-interactions

- **Hover reveals (message actions)** `[approx]`: hovering a bubble row reveals a small action
  bar floating beside the bubble (toward center): reply + react icon-buttons, 28×28,
  `--color-bg-chip` pill with `--shadow-chip`, 20px glyphs `--color-icon`; fade in 120ms.
  Hidden on touch devices (long-press optional, skip if timeboxed).
- **Scroll-to-bottom button:** appears when scrolled >300px from bottom [approx]. Circular
  **36px**, background `--color-bg-chip`, `--shadow-chip`, chevron-down 20px `--color-icon`,
  positioned bottom-right of the message area (16px from right, 12px above composer),
  `z-index: var(--z-scroll-btn)`. If unread messages arrive while scrolled up, attach the §3.2
  unread badge, overlapping the button's top edge (centered, `margin-top: -9px`). Click →
  smooth-scroll to bottom, clears the count.
- **Enter / Shift+Enter:** Enter sends (when non-empty and socket OPEN); Shift+Enter inserts a
  newline. Sending clears the input, keeps focus, resets input height to 32px.
- **Esc behavior**, in priority order: close open menu/emoji picker → cancel reply state →
  close topmost modal/takeover (Settings, GroupInfo, NewChat/NewGroup step back) → clear
  search text if search focused → on ≤640px, back to list [approx last step].
- **Focus rings:** keyboard focus only (`:focus-visible`): 1px solid `--ultramarine` for the
  search field and composer input (border swap, no offset); everything else
  `outline: 2px solid var(--ultramarine); outline-offset: 2px` [approx]. No mouse-focus rings.
- **Selected-conversation keyboard nav** `[approx]`: with the list focused, ↑/↓ move selection
  (opens the conversation on move, matching Signal desktop); `Cmd/Ctrl+K` focuses search;
  typing in search + Enter opens the first result; `Alt+↑/↓` moves conversation anywhere in app.
- **Send button reveal:** 120ms opacity + scale 0.8→1 (§3.10). Mic/attach fade out 120ms.
- **Row hovers:** background-color transition 120ms ease-out. Icon-button hovers likewise.
- **Optimistic send:** bubble renders instantly with the `sending` spinner tick; swaps to
  `sent` on ack without layout shift (12→12px box; delivered widens to 18px — reserve 18px
  width for the tick box on outgoing messages to avoid text reflow).
- **Auto-scroll:** timeline pins to bottom when the user is within 100px of bottom [approx];
  otherwise increment the scroll-button unread count.

---

## 5. Implementation checklist for M4 (execute top-to-bottom)

1. **`app/globals.css` + `app/layout.tsx`** — paste the §1 token block; set `font-family`,
   body colors, scrollbar styles; add the `data-theme` bootstrap script (read `localStorage.theme`,
   apply before paint to avoid flash) in `layout.tsx` `<head>`.
2. **Replace every `#3A76F0` (or other blue) in the codebase with `var(--ultramarine)` /
   semantic tokens.** Grep for hex literals in `frontend/` and convert all colors to tokens.
3. **`app/(chat)/page.tsx`** — implement the §2 grid (320px / 1fr, 100dvh), the 640px
   single-pane media query, and mount `ReconnectBanner` above the grid.
4. **`Avatar.tsx`** — 12-pair palette, hash rule, initials rule, size prop (28/32/48/80) per §3.3.
5. **`ConversationList.tsx`** — header (own 28px avatar, `Chats`, pencil `New chat`, `⋮`),
   28px search field per §3.1; rebuild rows to §3.2 exactly (72px, 10px radius, 11px container
   inline padding, 2px margins, hover/selected tokens, 18px badge, 2-line preview, preview
   ticks, typing dots, shared timestamp util).
6. **Timestamp util (`lib/`)** — implement the §3.2 format table once; use in list + bubbles.
7. **`ChatPane.tsx` (header)** — 52px header per §3.4: 32px avatar, name/subtitle, four
   icon-buttons wired to `Coming Soon` toasts; mobile back chevron.
8. **`ChatPane.tsx` (timeline)** — white/#121212 background, 16px edge padding, day-divider
   chips (§3.5), E2EE notice at conversation start (§3.19), typing-indicator bubble (§3.9),
   scroll-to-bottom button with unread badge (§4), auto-scroll rule.
9. **`MessageBubble.tsx`** — full §3.6 rebuild: colors, 18px radius, 12/8 padding, max-width
   rule, run detection (3-min/same-author/same-day/no-reactions) with 4px corner flattening and
   1px run gaps, group-only 28px avatar column + tinted author names, in-bubble metadata row.
10. **`MessageBubble.tsx` (ticks)** — add the `StatusTick` inline-SVG component with the four
    §3.8 states (sending spinner / sent / delivered / read), `--tick-halo` wiring; reuse the
    12/18px variant in the conversation-row preview.
11. **`MessageBubble.tsx` (quote + reactions)** — reply/quote block (§3.7); reactions pill +
    hover action bar + 6-emoji picker (§3.11, §4) — reactions LAST, only if M5 bonus time allows.
12. **`Composer.tsx`** — §3.10 rebuild: 42px container, 18px-radius input on `--color-input-bg`,
    `Message` placeholder, 32→72px auto-grow, emoji/mic/attach ghost buttons, mic→send swap
    (32px ultramarine circle, white paper-plane), Enter/Shift+Enter, disabled-when-disconnected,
    reply preview strip.
13. **`ReconnectBanner.tsx`** — §3.13 strip with spinner + `Reconnecting…`/`Connected` states.
14. **Toast system** — small `Toast` in `components/` per §3.14; wire every mocked control
    (video, phone, search-in-chat, emoji, mic, attach, placeholder settings) to `Coming Soon`.
15. **`NewChatModal.tsx`** — convert to the left-pane takeover (§3.15) with ListTile contacts,
    `New group` + `Note to Self` rows.
16. **`NewGroupModal.tsx`** — two-step takeover (§3.16): member picker with checkboxes/chips →
    name step; shared primary pill button.
17. **`GroupInfoPanel.tsx`** — 320px slide-in panel (§3.17): hero, member ListTiles, admin `⋮`
    actions, add-members row, rename.
18. **`SettingsModal.tsx`** — §3.18: nav column, WORKING Appearance theme switcher
    (System/Light/Dark → `data-theme` + `localStorage`), Profile, `Coming Soon` placeholders.
19. **Empty state** — §3.12 in the right pane (96px logo SVG, `Welcome to Signal`, nonprofit
    footer line).
20. **`app/login/page.tsx`** — restyle to the §3.20 staged card: logo lockup, phone → OTP
    stages, primary pill buttons, Alice/Bob demo ghost pills, nonprofit footer.
21. **Sweep:** focus-visible rings everywhere; Esc stack (§4); verify both themes screen-by-
    screen against the token table (left pane #f0f0f0/#2e2e2e, chat #fff/#121212, incoming
    bubble #e9e9e9/#3b3b3b, selected row #dedede/#4a4a4a); confirm weight 600 (never 700).
22. **Responsive sweep (DESIGN_BRIEF test matrix):** 375×812, 768×1024, 1280×800 — light AND
    dark each, plus phone keyboard-open composer. Verify the §2 mobile-hardening block: 16px
    inputs ≤640px, ≥44px coarse-pointer hit areas, `@media (hover:hover)` guards,
    `overscroll-behavior: contain`, safe-area insets, `prefers-reduced-motion` fallbacks,
    back-chevron list↔chat navigation.

---

## 6. Sources

**Independently re-verified against `signalapp/Signal-Desktop` `main` on 2026-07-10:**
ultramarine `#2c6bed` (+ dawn `#406ec9`, light `#6191f3`, logo `#3b45fd`); full gray ladder
(02 #f6f6f6 · 04 #f0f0f0 · 05 #e9e9e9 · 15 #dedede · 20 #c6c6c6 · 25 #b9b9b9 · 45 #848484 ·
60 #5e5e5e · 62 #545454 · 65 #4a4a4a · 75 #3b3b3b · 80 #2e2e2e · 90 #1b1b1b · 95 #121212);
all 12 avatar bg/fg pairs A100–A210; `$header-height: 52px`; left pane MIN 97 / SNAP 200 /
MIN_FULL 280 / MAX 380 + default 320; `COLLAPSE_WITHIN = 3 * MINUTE` (+ same author, same day,
no reactions, no unread indicator); bubble max-widths `min(306px, calc(100% - 38px))` / 370px /
50vw at the 514/606 breakpoints; `$normal-row-height: 72px`; sending icon `rotate 4s linear
infinite`; typing `1600ms ease`, stops 0%/20%/40%, delays 0/160/320ms, 6px dots gray-60/white,
`typing-animation-bare` (opacity-only) in the left pane; v3 message_status icons = checks in
circles, read = filled (never blue).

- https://github.com/signalapp/Signal-Desktop/blob/main/stylesheets/_variables.scss — colors, avatar pairs, $header-height 52px, NavTabs 80px
- https://github.com/signalapp/Signal-Desktop/blob/main/stylesheets/_modules.scss — bubbles, metadata, ticks, list rows, unread badge, typing animation, splash logo
- https://github.com/signalapp/Signal-Desktop/blob/main/stylesheets/_mixins.scss — font scale, avatar colors, floating header chip
- https://github.com/signalapp/Signal-Desktop/tree/main/stylesheets/components — NavSidebar, SearchInput, ConversationHeader, CompositionArea, CompositionInput, ListTile, Inbox, TimelineFloatingHeader, Avatar, Modal, ConversationView
- https://github.com/signalapp/Signal-Desktop/blob/main/ts/util/leftPaneWidth.std.ts — pane width constants (97/200/280/380)
- https://github.com/signalapp/Signal-Desktop/blob/main/ts/state/selectors/items.dom.ts — default left-pane width 320
- https://github.com/signalapp/Signal-Desktop/blob/main/ts/util/timelineUtil.std.ts — 3-min collapse window, 514/606 width breakpoints
- https://github.com/signalapp/Signal-Desktop/blob/main/ts/components/conversation/Message.dom.tsx — 28px group avatar last-of-run, groups only
- https://github.com/signalapp/Signal-Desktop/tree/main/images/icons/v3/message_status — sending/sent/delivered/read SVGs (checks in circles; read = filled)
- https://github.com/signalapp/Signal-Desktop/blob/main/ts/components/ChatsTab.dom.tsx — empty state (logo 96, Welcome to Signal, nonprofit footer)
- https://github.com/signalapp/Signal-Desktop/blob/v7.23.0/ts/components/CompositionArea.tsx — stable composer arrangement, send-fill glyph
- https://github.com/signalapp/Signal-Desktop/blob/main/ts/util/formatTimestamp.dom.ts — Now / {n}m / weekday / date formats
