# DESIGN BRIEF — STARN "Pretty Document View" + Question-Card v2

**Grounding screenshots (taken live from localhost:3000):** `briefs/current-development.png` (CONOPS doc pane — flat markdown), `briefs/current-rtm.png` / `current-rtm-table.png` (RTM matrix — wrapping ID column, no sticky head), `briefs/current-rtm-open-questions.png` (Q5–Q7 as raw prose bullets). Persisted design-system master: `design-system/MASTER.md`.

**Design-system run note (evidence for the gate):** the ui-ux-pro-max skill directory contains only `SKILL.md` — its `scripts/search.py` is not installed in this environment, so `--design-system --persist` could not execute. I hand-produced the equivalent MASTER at `design-system/MASTER.md`, verified against the live tokens in `web/src/index.css` and the real UI. Zero search-derived claims are unverified; everything below is anchored in read source files.

---

## 1. Current-state diagnosis (from screenshots + source)

- `Markdown.tsx` renders one flat `doc-prose` stream: H1/H2/H3 are only font-size bumps (`1.25rem/1.1rem`), tables are raw bordered grids inside a bare `overflow-x-auto` div, requirement IDs (`SS-01.c`, `ICD-E-01`, `DD-R2`) render as plain bold white text, and the "Open Questions"/"User Answers" sections are indistinguishable from body prose.
- The doc pane host (`DevelopmentView.tsx:1663`) applies `max-w-[72ch]` to prose but yields the full width to tables — correct instinct, needs a contained scroll region.
- `QuestionPanel.tsx` cards are a flat stack: label row → title → detail bullets → composer. No topic chip, no BLUF hero, no order hierarchy of findings → suggestion → alternatives → defer → response → thread.

## 2. Design system tokens (build on `:root`, do not invent hexes)

Add exactly three tokens to `web/src/index.css` `:root` (all derived from existing surfaces):

```css
--sf-row-tint: rgba(148, 163, 184, 0.045);   /* table stripe tint — positional, not hue */
--sf-hero-hairline: rgba(217, 164, 65, 0.35); /* brass underline under H1 hero */
--sf-callout-tint: 0.5;                        /* multiplier knob for callout bg alpha */
```

Everything else consumes existing tokens (`--sf-panel/raised/hover/border-weak/border-strong/text/-2/mut/brass/power`) and the Tailwind amber/violet/rose workflow classes already in use. No new hues; no blue/green outside `DocDiff`.

## 3. Typography scale + measure

| Element | Spec |
|---|---|
| Body (`.doc-view`) | 15px → 16px at wide pane, `line-height: 1.65`, `--sf-text` |
| Measure | `max-w-[75ch]` for prose blocks (bump from current 72ch); tables + callouts may span full pane width |
| H1 hero | 1.5rem / 700, `--sf-text`, brass hairline underline (2px, `--sf-hero-hairline`) |
| H2 (section card header) | 1.125rem / 700, `--sf-text` |
| H3 | 1rem / 600, `--sf-text` |
| Metadata (path, counts) | `.font-telemetry` 11px `--sf-text-mut` (pattern already used for `doc.path`) |
| Table cells | 12px body, 11px mono for ID columns |

Base UI text stays ≥12px everywhere; nothing below 11px mono.

## 4. Per-section treatments (Markdown.tsx presentation pass)

Markdown.tsx gains a section-grouping pass (flat structure — one level of grouping, no nested trees): blocks between H2s are wrapped in a section container; H1, `## Open Questions`, `## User Answers (Pending Incorporation)`, and a leading "BLUF" section are detected by heading text match and routed to their callout/hero treatment. **Files stay .md; this is rendering-only.**

1. **H1 title hero — `.doc-hero`**: full doc-column band, `background: var(--sf-panel)`, `border: 1px solid var(--sf-border-weak)`, `border-radius: 8px`, `padding: 20px 24px`, brass 2px hairline on the block's left edge or under the title. The existing mono `doc.path` line stays directly above it. Only the first H1 gets this; subsequent stray H1s (rare) degrade to H2-card style.
2. **H2 section cards — `.doc-section-card`**: each H2 opens a card: `background: var(--sf-panel)`, `border: 1px solid var(--sf-border-weak)`, `border-radius: 8px`, `padding: 16px 20px`, H2 inside with `padding-bottom: 8px; border-bottom: 1px solid var(--sf-border-weak)`. The doc background under cards shows `--sf-void` so cards read as raised. First card gets `margin-top: 16px` after hero.
3. **`## Open Questions` → amber callout — `.callout.callout--amber`**: `background: rgba(245,158,11,0.08)` (amber-950 tint family already used in QuestionPanel), `border: 1px solid rgba(245,158,11,0.35)`, `border-left: 3px solid amber-500`. Header row: lucide `MessageSquare` icon + "Open Questions" + count chip (`.font-telemetry`, e.g. "7"). Body renders the section's Q-items as question cards (§7).
4. **`## User Answers (Pending Incorporation)` → violet callout — `.callout.callout--violet`**: same geometry; `background: rgba(139,92,246,0.08)`, border-left `#8b5cf6`, lucide `Inbox` icon + label "User Answers — Pending Incorporation" + count. Matches the violet semantics used by `stateChip.applied`/queued.
5. **BLUF → recommendation callout — `.callout.callout--brass`**: brass `#d9a441` at 0.08 bg, 0.35 border, border-left brass; lucide `Target` icon + "Bottom Line Up Front" label. Brass = recommendation (it's the metadata/emphasis hue, distinct from crimson=power/action).
6. **Requirement-ID chips — `.req-chip`**: extend `renderInline`'s tokenizer with the ID pattern `(?:[A-Z]{2,4}-[A-Z0-9]{1,3}(?:-[A-Z0-9]+)?(?:\.[a-z])?|ICD-E-\d+|DD-R\d+)` → `<code class="req-chip">`. Style: `.font-telemetry` 11px, `background: var(--sf-raised)`, `border: 1px solid var(--sf-border-strong)`, `border-radius: 4px`, `padding: 1px 6px`, `white-space: nowrap`, color `--sf-text-2`, brass 1px top hairline optional. **All ID families look identical** — differentiation is the literal prefix text, never color. Where `lib/requirementAnchor.extractRequirementIds` matches, wrap in the existing anchor-highlight machinery (reuse `animate-anchor-flash` violet flash on click-through from QuestionPanel chips).

## 5. Tables (RTM/BOM matrices)

Replace Markdown.tsx's bare `overflow-x-auto` table wrapper with `.doc-table-scroll` + `table.doc-table`:

- **Container**: `overflow-x: auto`, `role="region"`, `aria-label="Data table — scrolls horizontally"`, `tabindex="0"`, `border: 1px solid var(--sf-border-weak)`, `border-radius: 8px`, `background: var(--sf-panel)`. Tables opt out of the 75ch measure (full pane width), as the host already intends.
- **thead**: `position: sticky; top: 0; z-index: 1;` `background: var(--sf-hover)`, `color: var(--sf-text-2)`, 11px `.font-telemetry`, `text-transform: none`, bottom border `--sf-border-weak`. ~~Sticky works against the doc-pane scroll container (`ref={docContentRef}` div).~~ **Revision (critic aa83f169):** sticky thead is dead code here — the required overflow-x wrapper makes the wrapper itself the sticky containing block (`overflow-x:auto` computes `overflow-y` to `auto`), so vertical stickiness against the doc pane never engages. Horizontal containment wins; the thead keeps strong visual weight (brass text on tinted bg + token border) instead of `position:sticky`.
- **Striping via token tints, not color-alone**: `tbody tr:nth-child(even) { background: var(--sf-row-tint); }` plus 1px `border-bottom: rgba(148,163,184,0.10)` separators — stripes are positional/structural, not semantic hue, satisfying the no-color-only rule.
- **Cells**: `padding: 8px 12px; vertical-align: top; font-size: 12px; line-height: 1.5`. ID-carrying cells: `.req-chip` renders nowrap so `SS-01.c` never breaks mid-token (current defect visible in `current-rtm-table.png`).
- **Sticky first column (optional, phase 2)**: `td:first-child, th:first-child { position: sticky; left: 0; background: var(--sf-panel); border-right: 1px solid var(--sf-border-weak); }` — opaque bg required; stripe rows must re-paint first cell opaque too (`tr:nth-child(even) td:first-child { background: var(--sf-hover); }`).

## 6. Mini-TOC

- **Trigger**: a compact strip between the `doc.path` line and the hero: button "Contents · 6 sections" (`.font-telemetry`, `min-height: 32px`, lucide `List` icon). Collapsed by default on narrow panes, expanded by default ≥1024px.
- **Behavior**: popover panel (`.mini-toc`) listing H2 titles in order, violet-400 active item determined by IntersectionObserver on section cards (active = last section whose top crossed 25% viewport). Chip click → `scrollIntoView` (smooth under `motion-safe:` only) + `focus({ preventScroll: true })` on the section card with `tabindex="-1"`.
- **No layout shift**: popover is absolutely positioned; trigger size is fixed.

## 7. Question-card v2 (QuestionPanel presentation; fix worker owns title-shortening logic)

Card shell `.qcard`: keep `rounded-lg border-l-2 p-3` geometry and the existing four `cardTone` states (amber / rose / neutral-auto / neutral-dwell) — left border + icon + text label already satisfy no-color-only. Restructure the inner stack to this vertical order:

1. **Topic chip row** — from `groupPortalItemsByTopic` (`lib/portalGrouping`): pill `rounded-full border border-[#3b4658] bg-[#0d1017] px-2.5 py-0.5 text-[11px] .font-telemetry text-[#a8b3c4]` with `min-height: 24px`. Dismiss × stays top-right, hit area grows to 24×24.
2. **Short title hero** — h3-styled, `text-sm font-bold text-[#e8edf5]`, `line-clamp-2`; "Show full question" expander remains.
3. **BLUF hero strip** — first sentence / distilled ask of `item.detail` (or `item.meta.proposedAnswer` lead) inside `.callout--brass`-tinted mini-band: `bg-[rgba(217,164,65,0.06)] border-l-2 border-[#d9a441]/50 px-2.5 py-2 rounded-r-md text-xs`.
4. **Findings** — existing `renderDetail` bullet list, unchanged classes (`text-xs text-[#a8b3c4] list-disc pl-3.5`).
5. **Suggestion** — research-gate proposal block: violet-tinted panel (`border-[#8b5cf6]/60 bg-[#2e1065]/40` — matches `onConfirmProposal` area), Confirm/Reject buttons at min-height 32px, inline proposal edit unchanged.
6. **Alternatives** — optional detail bullets group labeled "Alternatives considered" (11px muted mono label + the existing bullet list styling).
7. **Defer** — the existing dismiss/"leave as open question" actions row, right-aligned, ghost-button style `border-[#3b4658] bg-[#0d1017] text-[#a8b3c4]`, min-height 44px.
8. **Response** — composer: unchanged behavior/drafts; keep `min-h-[44px]`, violet send button.
9. **Advisory chat** — thread area: existing violet/neutral bubbles (`bg-[#2e1065]/40` user, `bg-[#0d1017]` advisory), separated by a `border-t border-[#2a3342]` with 11px mono label "Advisory thread".

**ReactBits candidates** (searched; install only what's justified — vendoring convention is `web/src/components/reactbits/<Name>/<Name>.tsx`):

| Candidate | Fit | Verdict |
|---|---|---|
| **SpotlightCard** (`motion`-free, zero deps, built-in `prefers-reduced-motion` guard) | pointer-follow glow for the **single active/expanded** question card or BLUF hero band | Adopt — pass `spotlightColor` crimson at low intensity; **never on all 13 cards** (rAF + window pointermove per card is a real cost). Themed via `style={{'--spotlight-card-surface': 'var(--sf-panel)'}}` |
| **DecryptedText** (deps: `motion/react` — `motion` v14 already installed, no new package) | one-shot scramble on the **H1 doc hero title** only, `animateOn="view"` once per doc load | Adopt as polish, `motion-safe` gate; skip entirely if it risks render jank on doc switch (it re-runs per `text` change) |
| Glass Surface / Gooey Nav / Animated List / Stepper | decorative/animation-heavy; glass + gooey contradict the low-noise document surface | Reject |

No installs outside these two; both are dependency-free at the npm level.

## 8. CSS recipe names (follow index.css conventions — kebab, tokenized, reduced-motion guards)

```
doc-view · doc-hero · doc-section-card · callout · callout--amber · callout--violet ·
callout--brass · req-chip · doc-table-scroll · doc-table (thead/striping/sticky-col) ·
mini-toc · mini-toc__chip · mini-toc__chip--active · qcard · qcard__topic · qcard__hero
```

All animations get `@media (prefers-reduced-motion: reduce) { … animation: none; }` entries in the existing reduce block.

## 9. Ordered implementation task list

1. Add the three `:root` tokens to `web/src/index.css`.
2. `Markdown.tsx`: add section-grouping pass + heading-text routing (H1 → hero, H2 → section cards, Open Questions / User Answers / BLUF → callouts) with flat DOM.
3. `Markdown.tsx`: extend `renderInline` tokenizer with the req-ID pattern → `.req-chip`; wire `lib/requirementAnchor` anchors.
4. Write the §8 recipes into `index.css` (doc-hero, doc-section-card, callouts, req-chip).
5. Table treatment: `.doc-table-scroll` container with role/aria/tabindex, sticky thead, token-tint striping, chip-nowrap ID cells; optional sticky first column last.
6. Mini-TOC: trigger strip + popover + IntersectionObserver active tracking + motion-safe smooth scroll.
7. `QuestionPanel.tsx` card v2: topic chip → short title → BLUF hero → findings → suggestion → alternatives → defer → response → thread (state machinery untouched).
8. Optional polish: SpotlightCard on the single expanded card; DecryptedText on H1 hero (both behind justification/motion gates).
9. Update `Markdown.test.tsx` for new section structure; add a reduced-motion snapshot check.
10. Final gate: Playwright pass on localhost:3000 comparing against `design-system/MASTER.md` + §1 screenshots (no horizontal overflow, no CLS, contrast spot-checks).

## 10. DO-NOT list

- **No new npm dependencies** without written justification; `motion` and `lucide-react` already cover the candidates above.
- **No layout shift**: no animation may alter geometry; sticky/popup elements reserve space; hero/callout heights are content-driven, not animated.
- **Reduced motion**: every new keyframe/transition dies under `prefers-reduced-motion: reduce`; add entries to the existing reduce block.
- **DocDiff red/green is untouchable** — no restyle, no token reuse, no shared classes (`bg-[#14532d]/*`, `bg-[#7f1d1d]/*` stay verbatim).
- **No blue/green outside diff rows**; no emoji (lucide icons only); no color-only state encoding (always icon/text/border companion).
- **No layout-shift-on-load** from mini-TOC or chips (chips are inline, nowrap, same line-height).
- **No deeply nested layout trees** — section grouping is exactly one wrapper level; cards remain flat stacks.
- **No raw hex in components** where a token exists; new hexes only via the three `:root` tokens defined in §2.
- Files stay `.md`; this brief is presentation-only. The concurrent fix worker owns question-title shortening — do not touch `item.title` data.

---