# Design Brief — Signal Clone (feed to the design/UI pass alongside DESIGN.md)

## Product constraint (non-negotiable)
This is a Signal clone graded on **visual similarity to Signal**. DESIGN.md (researched from
Signal Desktop's open-source stylesheets) is the visual authority for colors, spacing, bubble
geometry, and component anatomy. This brief adds the **responsive behavior contract**: the app
must conform to phone, tablet, and laptop the way *Signal itself* does on each device class —
not a generic responsive redesign.

## Reference behavior per device class (clone Signal's own answers)

### Phone (< 640px) — behave like Signal iOS/Android
- **Single pane, stack navigation.** Conversation list is the home screen, full width.
  Selecting a chat slides the chat view in full-screen; a back chevron (top-left) returns
  to the list. State model: `selectedConversationId === null` ⇒ list view.
- Composer pinned to the bottom; message area scrolls independently.
- No hover states — every affordance visible or reachable by tap. Tap targets ≥ 44×44px.
- Search field and new-chat button in the list header exactly as Signal mobile places them.

### Tablet (640–1024px) — behave like Signal on iPad
- **Two panes, compact list.** List pane narrows to ~280–320px fixed; chat takes the rest.
- Modals stay centered overlays (not full-screen takeovers).

### Laptop / desktop (> 1024px) — behave like Signal Desktop
- **Two panes.** List pane ~320px (may grow slightly on very wide screens), chat fills the rest.
- Bubbles keep max-width ~66% of the chat pane so lines never sprawl on wide monitors.
- Hover states active: row hover, timestamp reveal, icon buttons.
- Keyboard-first affordances: Enter sends, Shift+Enter newline, Esc closes panels/modals.

## Mechanical rules (the difference between "responsive" and "works on a phone")
1. **One breakpoint variable set** in CSS (`--bp-mobile: 640px`, `--bp-tablet: 1024px`);
   layout switches via CSS grid + media queries, not JS window-width listeners
   (JS may only mirror the state for the list↔chat navigation logic, via `matchMedia`).
2. **`100dvh`, never `100vh`** for full-height panes — mobile URL bars and the iOS keyboard
   break `100vh` (content hides behind the composer).
3. **`env(safe-area-inset-*)` padding** on the composer and headers — notched phones.
4. **Inputs use `font-size: 16px` minimum** — anything smaller triggers iOS Safari auto-zoom
   on focus, which wrecks the layout.
5. **`@media (hover: hover)` guards every hover-only affordance**, with a visible/tap
   equivalent on touch (e.g., timestamps always visible on mobile instead of hover-reveal).
6. **Scroll containment:** the message area is the only scrollable region in the chat view
   (`overscroll-behavior: contain`) — the page itself never scrolls.
7. **Auto-scroll to bottom** on new message only when already near the bottom; otherwise show
   the scroll-to-bottom pill with unread count (all three device classes).
8. **Touch + pointer parity:** swipe-back is nice-to-have; the back chevron is the contract.
9. **Dark mode via `[data-theme]` tokens** (already in globals.css), respecting
   `prefers-color-scheme` as the default, with the in-app Appearance setting overriding.
10. **`prefers-reduced-motion`** disables the typing-dots bounce and pane-slide transitions.
11. Test matrix (QA pass runs all of these): 375×812 (phone), 768×1024 (tablet),
    1280×800 (laptop) — light and dark each; plus the phone keyboard-open composer case.

## What NOT to do
- No hamburger menus, no bottom tab bars, no FABs — Signal doesn't use them on any platform.
- No third breakpoint redesigns: components keep identical anatomy across sizes; only the
  pane arrangement and density change.
- No CSS framework; extend the existing CSS-variable token system and CSS modules.
- Never hide core actions behind a device-specific UI that the other devices lack —
  feature parity across all three classes.
