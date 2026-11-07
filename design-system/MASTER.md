# STARN — Sith Fabricator Design System (MASTER)

Product: STARN Hardware Program Command Center (React 19 + Vite + Tailwind v4 web app, `web/`)
Scope of this Master: the Engineering Studio doc pane ("pretty document view" for rendered .md
documents) and the Question Panel question-card surface.

> Derived from the ui-ux-pro-max design-intelligence workflow. The search script was not
> available in this environment; the direction below is hand-verified against the live tokens
> in `web/src/index.css` and screenshots of the running app (localhost:3000,
> `briefs/current-development.png`, `briefs/current-rtm*.png`).

## Pattern & Style

- Pattern: **tool / technical workspace** — dense engineering documents, requirement traceability,
  Q&A workflow. Content-first, dark mode, low decorative noise outside the hero.
- Style: **Sith Fabricator** — obsidian surfaces, crimson power accents, brass hairline details.
  Imperial angularity (`cut-corner`) is reserved for primary actions; document surfaces stay
  rectangular (rounded-lg) so long-form text reads calmly.
- Violet = review workflow; amber = needs-input; red/green ONLY inside `DocDiff` rows.
  Blue/green appear nowhere else. No emoji. Never color alone — always pair hue with icon,
  text label, or positional treatment.

## Color tokens (from `web/src/index.css` :root)

- `--sf-void #05070c` · `--sf-panel #0d1017` · `--sf-raised #11151d` · `--sf-hover #171c26`
- `--sf-border-weak #2a3342` · `--sf-border-strong #3b4658`
- `--sf-text #e8edf5` · `--sf-text-2 #a8b3c4` · `--sf-text-mut #6e7d92`
- `--sf-power #ff2a3c` (primary/running) · `--sf-brass #d9a441` (metadata/hero)
- Workflow hues stay Tailwind amber (needs-input), violet-400/500 (`#8b5cf6`, review),
  rose (critic-blocked). Raw hex in components is an anti-pattern — use tokens/classes.

## Typography

- UI font: system sans (app default). Mono recipe: `.font-telemetry` (tabular-nums, 0.03em)
  for paths, requirement IDs, table cells carrying IDs, diff text.
- Document scale (doc pane): body 15–16px / line-height 1.65 · measure `min(100%, 88ch)` on
  `.doc-flow` = 796 px cap at the 16.8 px doc body, binds only above ~844 px of pane (§3d.2) ·
  tables/code keep the section card's full width · H1 1.5rem/700 · H2 1.125rem/700 ·
  H3 1rem/600 · small print 0.75rem mono muted. Headings 1em top / 0.4em bottom margin.

## Effects (canonical recipes, see index.css)

- `doc-prose` base; new doc-view recipes: `doc-view`, `doc-hero`, `doc-section-card`,
  `callout` (+ `--amber`, `--violet`, `--brass`), `req-chip`, `doc-table`,
  `doc-tocbar` (36 px one-row section strip) + `doc-tocmenu` (44 px rows), `qcard` family.
  The old wrapping `mini-toc` recipe is deleted (§3d.1).
- Motion: entrance animations ≤300ms, one-shot, `prefers-reduced-motion: reduce` kills all
  animation (`motion-safe:` guards). No layout shift from any animation (reserve space).

## Accessibility floor (WCAG 2.1)

- Contrast ≥4.5:1 body text (tokens already comply), ≥3:1 large text.
- Targets ≥44×44px, 8px+ spacing; icon-only buttons get `aria-label`.
- Focus: existing `*:focus-visible` double-ring (void + crimson) must survive clip-path
  (inner-outline fallback exists on `.cut-corner`).
- Tables: `role="region"` + `aria-label` + `tabindex="0"` on scroll containers;
  sticky thead announces column context.

## Navigation geometry decision (record, Phase 2 eval)

- Top-level navigation stays a horizontal top bar (`h-14`, 56px) — NOT a vertical
  tab rail. Rationale: the Engineering Studio is a horizontal split-pane (doc |
  chat); every px of rail width is paid twice (once per pane), while the bar's
  56px is paid once. Panes at 1280px viewport are 636px wide — at the ~634px
  (72ch) reading comfort limit — so any rail ≥56px pushes laptop-width panes
  below comfortable line length. Switching between the 5 hubs is low-frequency
  (destination nav, not tool-mode), so a persistent rail buys nothing users need.
- Doc-pane "maximize vertical space" is served per-pane by existing
  DevelopmentView focus controls (panel collapse / maximize toggles), not by
  global chrome re-layout.
- Tab buttons in the top bar must be ≥44px tall (`min-h-[44px]` inside the 56px
  header). If a side rail is ever introduced, same floor applies per item.

## Collapsible top chrome decision (record, Phase 2 eval #2)

Evaluated: a collapsible top bar (Windows auto-hide taskbar / Lovable panel style) where the
56px header collapses to a minimal strip so the Engineering Studio gains vertical space while
reading. Verdict: **adopt a narrow, manual-only variant (P2, non-blocking); reject auto-hide
and the bare grab-strip variants.** The existing per-pane focus (zen/maximize) toggles are the
primary reading fix; they must get keyboard shortcuts FIRST (cheapest, zero geometry risk).

- Geometry: at a 900px viewport the doc body line is ~25px (15px/1.65). Expanded→collapsed
  56→32px gains 24px ≈ 1 line (+2.7%); 56→12px would gain 44px ≈ +4.9% but is rejected —
  12px cannot host a 44px hit target and cannot carry telemetry. Max honest gain ≈ 1.6 lines;
  the reading fix must not be sold as more than that.
- Monitoring invariant (hard rule): run-state awareness is NEVER hidden in any chrome state.
  Collapsed strip must still show: run-state dot (color + tooltip + aria-label), parked/error
  count badge, connection state, needs-input badge, current hub name. DocProgressBar collapses
  to a ~3px hairline pinned to the viewport top edge (always visible, expanded AND collapsed).
  A running autopilot with hidden DocProgressBar/RunState is a rejected hazard state.
- Interaction: MANUAL toggle only (click strip / `Ctrl+\` or `Meta+\`). No hover auto-reveal:
  the bar sits directly above pane headers and toolbar buttons; accidental pointer travel
  would slam chrome open over content, and hover-triggered layout shift violates the
  no-layout-shift rule. Esc closes the hub popover; Esc does NOT toggle the bar.
- Collapsed strip: 32px tall, in-flow (no overlay/occlusion). Contents: brand dot · current
  hub name · run dot · badge counts · Menu trigger. The strip itself is the expand trigger
  with an extended (≥44px effective) hit area. aria-expanded on the toggle; aria-controls.
- Tabs when collapsed: hub popover from the strip (lucide `Menu`), reusing HUBS — NOT
  "expand first". Focus-trapped, Esc closes, focus returns to trigger.
- Persistence: `starn.chrome.collapsed` in localStorage, default expanded, lg+ only
  (the mobile drawer owns nav below 1024px).
- Precedent keys already in use: `Ctrl+.` toggles the question panel — new shortcuts must
  not collide. Proposed pane-focus shortcuts: `Alt+1` chat focus, `Alt+2` doc focus,
  `Alt+0` reset (browser-reserved `Ctrl+1..9` avoided).

## Unified question chat decision (record, 2026-11-03)

Full record: `docs/superpowers/designs/2026-11-03-unified-question-chat-design.md`;
mockup + screenshots: `web/briefs/unified-chat-*.{html,png}`.

Problem: the question-card footer stacked an answer composer and an "Ask the specialist"
chat (332px at 1280x720 = the 50% cap), squeezing the decision memo to ~200px; users also
typed decisions into the advisory box where nothing was recorded.

Decision (rev 1): ONE conversation region per open question (siloed `meta.thread`, labeled
"Conversation about {title}"), ONE composer row with TWO explicit send verbs chosen at
send time: **Ask** (advisory, Enter) and **Answer** (records, Ctrl/Cmd+Enter). Rejected:
modeless-send + "use as answer" (2 steps for the common case), tabs (chrome).
Wrong Ask is harmless, wrong Answer is unrecoverable.

**Rev 2 (2026-11-06) — user-decided, supersedes the "no mode" call.** The composer now has
ONE two-position mode control (`[Advisory | Answer]`, `role=radiogroup`, in the composer's own
header row) and ONE send button whose colour, icon and label follow the mode. The original
screenshot failure was **two unlabeled peer text boxes**, not the existence of a mode; with one
input, the mode attached to that input, a permanent sentence on the box, and a louder skin for
the irreversible state, the failure cannot recur. Enter = send in the visible mode; `Alt+A`
toggles; `Ctrl/Cmd+Enter` is withdrawn (no hidden recording path). The mode is **bound to the
unsent draft**: advisory on mount, after every send, on question switch, and after Esc-clearing
the draft; never persisted; no idle timer (a silent disarm would send an answer out as an Ask).
Mode skins (never colour-only — words + icons + weight change too):

| | Advisory | Answer |
|---|---|---|
| composer | `1px #8b5cf6/50`, `bg #2e1065/22`, 2 px violet left rule, transparent header | `1px #ff2a3c/60`, `bg #1a0208`, 3 px crimson left rule, crimson-washed header |
| header sentence | `MessageCircleQuestion` "Nothing is recorded" (`#a99ee0`) | `Lock` "Sending records your answer — no undo" (`#ffb3bd`) |
| active segment | violet-deep fill, `violet-200` | crimson fill, white |
| send | outline violet, `MessageCircleQuestion`, **Ask** | solid `#d61f2c`, `SendHorizontal`, **Record** |

Geometry: rest region 141 px / memo 417 px at 1280×720 (was 93/465 in rev 1, 332/226 baseline);
identical in both modes (no shift on toggle); log cap 176 px; memo 200 px floor unchanged.

- Geometry: region 93px at rest (was 332px); memo body `min-h-[200px]` is a hard floor;
  thread log is a collapsible drawer between memo and composer, capped
  `clamp(96px,28vh,192px)` (proposal pending: `clamp(120px,40vh,264px)`), shrinks first.
- "Conclude from chat" = specialist drafts a proposal card from the dialogue (research-
  proposal family: violet/50 + violet-deep/20, Use proposal / Edit / Reject, 44px buttons);
  shown only after >=1 specialist reply and when no proposal is pending.
- Recorded answers = full-width crimson-ruled card with Lock icon + "Recorded answer"
  + state chip; ask bubbles stay right-aligned violet. Never color alone.
- Nav chip gets an icon+count pill (MessageSquare n; ListChecks when a proposal waits).
- Responsive by container width: >=600px icon+label+kbd; <600px text-only single row;
  <400px two rows. No Q-number labels (pager order != topic-grouped chip order).
- New tokens (aliases of existing values): `--sf-review #8b5cf6`, `--sf-review-fill #2e1065`,
  `--sf-record-fill #1a0208`.

Anti-patterns added: no second text input in the question card; bare Enter never records
while the composer is visibly advisory; Ask-intent replies never claim a decision; no mode
control outside the composer header and no tabs (rev 2 form only); no emoji/glyph icons
(`🎤`, `✓`) in the panel; no height animation on drawer/autosize; no 32px proposal buttons
(44px floor applies); no idle timer and no persistence for the composer mode.

## Chat-window geometry decision (record, 2026-11-03 rev 3 — user revision)

Full record: `docs/superpowers/designs/2026-11-03-unified-question-chat-design.md` §3c;
mockup + pixels: `web/briefs/unified-chat-window-mockup.html`,
`web/briefs/unified-chat-window-{1280,900}.png` (measured in the same pass, localhost:3000).

After using the shipped layout the user reported: the chat did not fill the pane, the chip strip was
unreachable, the doc header clipped `Edit`, text did not reflow when the pane was widened, and
`Conclude from chat` sat beside the transcript. Decision: **the left pane is a chat window.** Pinned
panel header + chips + question context header (title/BLUF), then a `flex-1 min-h-0` conversation whose
log is the only scroller, then a pinned composer. `ChatHeader`'s collapse toggle is **deleted** (not
repurposed) and survives only as a 44 px `Jump to latest` pill shown when the user is scrolled up;
auto-scroll fires only when already at the bottom. Log `max-height`/`min-height` removed → **176 px
becomes 343 px at 1280 and 326 px at 900**. Chips = one 45 px scroller + edge fade + 44 px chevrons +
`scrollIntoView({inline:'nearest'})` on the active chip. Doc header = container-query fold ladder
(Attach, Refresh, Diff, Approve phase → `⋯` at <=759; pane rails at <=629; selector name/status at
<=519; view-switch labels at <=429) that never hides `Edit`, the `Document|Details` switch or `⋯`.
Measure lives on one column (`min(100%, 72ch)`), bubbles `min(88%, 60ch)`. `Conclude from chat` moves
into the composer's Answer skin (mode-bar right, 30 px, zero log cost) and is disabled while a draft
exists, so exactly one of `Conclude` / `Record` is ever enabled.

Anti-patterns added: no log height cap and no collapsed thread; no auto-scroll while the user reads
history; no `ch`-capped row inside a percentage container; no `overflow-x` surface without a fade + a
44 px control; no doc-header control reaching past its pane; no concluding action outside the
composer's Answer skin.

## Document pane section nav + measure decision (record, 2026-11-03 §3d)

Full record: `docs/superpowers/designs/2026-11-03-unified-question-chat-design.md` §3d;
mockup `web/briefs/doc-pane-toc-mockup.html`, pixels `web/briefs/doc-pane-toc-1280x900.png`
(measured in that page at 1280×900, 636 px doc pane, 12 sections).

After real use the user reported two right-pane defects, both measured: the sticky mini-TOC wrapped to
**89 px at a 636 px pane and 165 px at the 360 px floor** (4 and 8 rows of every H2 title, permanently
stuck under the header), and the doc body was capped twice (`max-w-[72ch]` plus
`.doc-prose-document{max-width:75ch}`), so dragging the splitter widened the *pane* but not the
*document* — the extra width was dead, and the `docHasTable` "let tables use the width" branch was dead
code because the prose cap never lifted.

Decision 1: **the section nav is ONE 36 px row** — a horizontal strip with an edge fade, the active
pill auto-centred by `scrollLeft` (never `scrollIntoView`), and a 44 px `Sections` control at the
trailing edge that opens the full list as an `absolute` panel with 44 px rows (the overflow control
§3c.10 rule 4 requires). Rejected: `Sections ▾` as the only surface (no map, two steps for the common
jump) and a collapsed "On this page" disclosure (same 36 px at rest, zero information, and it
re-creates the wrap as a state to manage). Height is constant for 3 or 30 sections; 165 px → 36 px at
a 360 px pane. Gated by `@container docpane`, not a viewport breakpoint — `hidden lg:block` had removed
the nav entirely at a 900 px window.

Decision 2: **one measure owner**, `.doc-flow { max-width: min(100%, 88ch); font-size: <doc body
size> }` with a container-driven padding ladder (24 / 16 / 12 px), so prose is capped at 88ch = 796 px
≈ 99 characters (inside the 55–100 band at 27 px leading) instead of today's hard 679 px. Measured
ladder: 360 → prose 336 (42 chars) · 450 → 418 · 640 → 592 · 900 → 796 with 28 px gutters · 1272 →
796 with 214 px gutters. `ch` is font-relative: the doc body size must be declared on `.doc-flow` or
the cap silently resolves against the 14 px UI font (88ch = 677 px). Tables/code keep the section
card's full width (762 px) — a negative-margin breakout was measured and rejected (the card already
insets a table by 34 px, so breaking out would push it through its own border). The cap never binds at
the default 636 px pane, so the default reading column is unchanged. Splitter: 8 px gutter, 16 px pointer band via
`::before`, 3 px brass grip on hover/focus only, `aria-valuetext` naming both panes, double-click =
50/50 — and **no second maximize**, because `Focus document pane` (`zenPane='right'`) already exists
and now pays out.

Anti-patterns added: no wrapping / collapsible / multi-row section nav; no `scrollIntoView()` on a TOC
item; no fixed `ch` or px cap on the document body and no second measure owner; no viewport breakpoint
for doc-pane furniture; no second doc maximize and no splitter wider than a 16 px pointer band.

## Anti-patterns (do not)

- No new npm dependencies for this surface without written justification (existing: `motion`,
  `lucide-react`, vendored ReactBits under `web/src/components/reactbits`).
- No DocDiff red/green restyle. No layout shift. No color-only states. No emoji icons.
- No deep nesting in component trees (section grouping stays flat: H2 → card div).
- ReactBits SpotlightCard on every card (rAF/pointer cost) — active card only, or none.
- No vertical tab rail for hub navigation, and no labeled side rail (≥160px)
  while the Engineering Studio split-pane exists — see Navigation geometry
  decision above.
- No hover auto-hide / auto-reveal global chrome (accidental trigger over pane
  headers; unpredictability during long reading sessions) — see Collapsible
  top chrome decision above.
- No chrome state (expanded or collapsed) that hides run-state telemetry.
- No collapsed strip shorter than 32px, and no strip variant without a ≥44px
  effective hit area on its expand trigger.
- No second text input in the question card; no mode control other than the single two-position
  `[Advisory | Answer]` segment in the composer header (no tabs, no side-by-side send verbs); no
  keyboard path records from the advisory skin — see Unified question chat decision (rev 2) above.
- No collapsed thread and no log height cap in the question panel; no auto-scroll while the user is
  reading history; no `ch`-capped row inside a percentage container; no header control that can paint
  past its pane — see Chat-window geometry decision (rev 3) above.
- No silent mode changes: no idle auto-disarm, no cross-question/session persistence. The mode
  belongs to the unsent draft.
- No wrapping, collapsible or multi-row document section nav (the row is 36 px at every width and
  every section count); no `scrollIntoView()` on a TOC item; no fixed `ch`/px cap on the document body
  and no second measure owner (and `ch` always with its font context); no viewport breakpoint for
  doc-pane furniture; no second doc maximize and no splitter wider than a 16 px pointer band — see
  Document pane section nav + measure decision.
