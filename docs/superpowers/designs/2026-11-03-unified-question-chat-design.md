# Unified Question Chat — Design Record

**Date:** 2026-11-03 · **Rev 2:** 2026-11-06 · **Status:** Decided (rev 2 supersedes §2's "no mode" call), ready for build · **Owner:** ui-ux-specialist
**Scope:** `web/src/components/QuestionPanel.tsx` footer (composer + "Ask the specialist") → ONE conversation region.
**Mockup (rendered, screenshotted):** `web/briefs/unified-chat-mockup.html` (hash states `#rest #typing #collapsed #thread #inflight #error #proposal #edit #recorded #sheet`; serve with any static server on 127.0.0.1).
**Screenshots:** `web/briefs/unified-chat-{rest,thread,proposal}-{1280,900}.png`, `unified-chat-states-sheet.png` (10 states incl. narrow pane), baseline `unified-chat-00-current{,-900}.png`.

> **Rev 2 (2026-11-06) — read §2b first.** The user overruled the "no persistent mode" decision in §2:
> the composer now has an explicit two-position **Advisory / Answer** control. Everything else in this
> record still holds. §2 is kept for the reasoning record; §2b is binding where they disagree
> (Enter/Ctrl+Enter semantics, the geometry table, DO-NOT items 2 and 3).
> Rev 2 mockup + screenshots: `web/briefs/unified-chat-mode-mockup.html`,
> `web/briefs/unified-chat-mode-{advisory,answer,answer-typing,thread,900,sheet}.png`.

---

## 1. Problem (measured, not assumed)

Live app, 1280×720, Fuse-selectivity question (`unified-chat-00-current.png`):

| Region | Height |
|---|---|
| Question panel (below top bar) | 664 px |
| Header + topic/chip bar | ~106 px (1280) / ~131 px (900, header wraps) |
| **Footer (`composer` + `threadPanel`)** | **332 px = exactly the `max-h-[50%]` cap** |
| Decision memo region left | ~226 px; visible: title + BLUF + one line of findings |

At a 900 px viewport the pane is 450 px wide and the memo is cut right after BLUF (`unified-chat-00-current-900.png`).

The screenshot also shows the real failure: the user typed **"agreed with the main suggestion…"** into the *advisory* box. The specialist replied "Decision confirmed" — but **nothing was recorded**. Two boxes, two meanings, user picked the wrong one, and the reply implied a commit. The redesign must fix the space AND this intent confusion.

Secondary defects found while grounding (all fixed by this design):
- `🎤 Recording…` emoji (≈ line 1187) and `Resolved ✓` glyph violate "no emoji / lucide only".
- A **"Cancel"** slide-to-cancel hint renders over the answer textarea **at rest** (VoicePill `slideToCancel`). It must only exist while recording.
- A "Q3" label would be wrong: the pager's `3 of 13` is `items.findIndex` order, but the chip bar is grouped by topic (`groupPortalItemsByTopic`), so Q3 ≠ third chip. **Label by title, not number.**
- Two draft stores (`drafts`, `threadDrafts`) and two primaries (crimson Send + violet Ask) stacked.

---

## 2. Decision

> **Rev 2 note:** the paragraph below (A′, no mode) is **superseded by §2b (Variant E, user-decided)**.
> The siloed labeled conversation, ONE composer, memo floor, log clamp, recorded/proposal cards and
> the whole safety list survive unchanged; only the *way the intent is chosen* changed.

**D + "verb-at-send" (A′): one siloed, labeled conversation per open question, ONE composer row, TWO explicit send verbs — `Ask` and `Answer` — chosen at the moment of sending. No persistent mode.**

```
 ┌ conversation region (replaces footer) ──────────────────────────────────────────────┐
 │ [msg] Conversation about Fuse selectivity (…)  [msg 4] [v]   [Conclude from chat]    │ label row: 24px empty / 44px with history
 │ ┌ log (role=log, collapsible, scrolls, cap 192px) ─────────────────────────────────┐ │
 │ └──────────────────────────────────────────────────────────────────────────────────┘ │
 │ [ textarea 2→6 lines ................ ] (mic) [? Ask Enter] [> Answer Ctrl+Enter]    │ ONE composer row
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

### Why this and not the alternatives

| Option | Verdict | Reason |
|---|---|---|
| **A** segmented `[Ask \| Answer]` + one Send, Enter sends in current mode | **Rejected in rev 1 → user-overruled → adopted as E in §2b** | Rev 1 argument: a *sticky mode* looks like the failure in the screenshot (right words, wrong box). Re-reading `fuse-card-2.png` in rev 2: the failure was **two unlabeled peer boxes**, not a mode — so the mode was re-designed instead of refused (§2b.1–2b.3). |
| **B** modeless input, send = ask, separate "Use as answer" on last message/proposal | **Rejected as the base, kept as a subset** | Safest against accidental commits, but forces a 2-step flow for the common case "I know the answer, I'll type it", and "which message do I promote?" is ambiguous. Its good half survives: *Enter = Ask* (reversible) and *Conclude from chat → proposal card* (promotion with review). |
| **C** tabs `Discuss / Answer` | **Rejected** | Extra chrome (nav evals already rejected tabs), re-splits one conversation into two surfaces, and hides the thread while answering — the opposite of "the agent reads the dialogue". |
| **D** user's idea: one siloed labeled chat | **Adopted as the base** | Thread is already stored per item (`meta.thread`). Label + swap on question change is cheap and kills cross-question confusion. |
| **A′** D + two verb buttons, Enter = Ask, Ctrl/Cmd+Enter = Answer | **Adopted in rev 1 · superseded by E (§2b)** | No mode state. Asymmetric risk: a wrong **Ask** is harmless (a reply arrives, nothing recorded); a wrong **Answer** writes to the incorporation pipeline with no undo. E keeps that asymmetry (advisory is the default and the resting skin) but moves the choice into a visible control. |
| **E** (rev 2, user-decided): one composer + two-position `[Advisory \| Answer]` header control; border, fill, placeholder, send label/colour and icon follow the mode | **Adopted — §2b** | The user's requirement is explicit and the failure mode is fixable without a second input. Mode is *bound to the unsent draft* and resets after every send / on question switch, so it can never be inherited accidentally. |

### Mistake recovery (the screenshot scenario)
1. Specialist replies to an **Ask** must end with an explicit non-commit line (backend prompt requirement): *"Nothing is recorded yet — send it as your answer, or use Conclude from chat."* It must never say "Decision confirmed" for an Ask.
2. `Conclude from chat` drafts the proposal from exactly this dialogue → "agreed with the main suggestion" becomes a proper answer after review.
3. Typing the same sentence and pressing **Answer** is also valid: backend feeds the whole thread to the answering agent, so "agreed with the main suggestion" resolves against the log.

---

## 2b. Variant E — mode toggle (user-decided, rev 2)

**Binding for build.** Mockup: `web/briefs/unified-chat-mode-mockup.html` (states `#advisory #answer
#answering #thread #threadadv #recorded #sheet`). Screenshots: `web/briefs/unified-chat-mode-{advisory,
answer,answer-typing,thread,900,sheet}.png`.

### 2b.1 Decision record — what changed and why it is safe now

**User decision (2026-11-06, overrules §2):** one button that toggles advisory/dialogue mode and one
that turns on answer mode, with *"a visible difference between the modes by the color of the buttons
and chat box"*. A′ (two send verbs, no mode) is withdrawn as the base design; the rest of this record
is unchanged.

**What the original failure actually was** (`fuse-card-2.png`, re-read rather than re-argued): the
panel showed **two independent text boxes**, each with its own send button — "Your answer" (crimson
Send) and "Ask the specialist" (violet Ask). Same shape, same size, same dark fill, no mode name
anywhere, and the advisory box's only label was a 10 px caption *above* it. The user typed a decision
into the advisory box. So the defect is **two unlabeled peers** — not the existence of a mode.

**Why E cannot reproduce that defect** (each item is a check against the old screenshot):

1. **One input.** DO-NOT 1 still holds. There is no second textarea to pick wrongly, so "right words,
   wrong box" has no second box to land in.
2. **The mode is attached to the box it governs** — the control lives in the composer's own header
   row, not floating in the panel.
3. **The consequence is written on the box, permanently** — "Nothing is recorded" /
   "Sending records your answer — no undo". It does **not** vanish when the user types (the old
   placeholder did, and typing is exactly when the commit happens).
4. **The irreversible state is louder than the safe one** (crimson fill + 3 px stripe + solid Record
   vs violet hairline + outline Ask) instead of identical.
5. **The irreversible state cannot be inherited** — reset rule §2b.4.
6. **No hidden recording path** — no keyboard shortcut records from the advisory skin (§2b.5).

### 2b.2 Control shape: segmented `[Advisory | Answer]` (chosen over a single flip toggle)

```
 ┌ composer ───────────────────────────────────────────────────────────────────────┐
 │ ( Advisory )( Answer )                     Nothing is recorded      ← mode header │
 │ ┌ textarea 44→122px ─────────────────────────────┐ (mic)  [ Ask ]   ← input row  │
 └──────────────────────────────────────────────────────────────────────────────────┘
```

| Candidate | Verdict | Reason |
|---|---|---|
| **Two-position segmented control** (picked) | Adopted | Both positions always visible → the user learns there are two modes *before* typing. Stable geometry (label never changes, so the send button never moves). `role="radiogroup"`/`radio` gives arrow-key switching and "1 of 2, selected". The filled segment is a second, word-free mode indicator. |
| Single flip toggle (one button that swaps label+colour) | Rejected | With a send button next to it, one button showing only the *current* state is genuinely ambiguous: does "Answer" mean "you are in answer mode" or "press to send an answer"? That is the same class of ambiguity as the two-box failure. Its label also changes width ("Advisory" ↔ "Answer"), so the row reflows on every toggle. And it hides the alternative mode, so a first-time user never sees that answering is possible. |
| Mode tabs above the log | Rejected | Re-splits one conversation into two surfaces and hides the thread while answering (§2 option C). |
| Mode in the panel header (far from the input) | Rejected | The indicator must be adjacent to the commit point; a 24 px caption 300 px above the box is what the screenshot already had. |

**Placement:** the control is the composer's **header row**, left-aligned; the send button stays at
the right edge of the input row. Left = setting, right = commit.

### 2b.3 The two skins — four redundant channels, never colour-only

| Channel | **Advisory** (default, quiet) | **Answer** (armed, loud) |
|---|---|---|
| composer border | `1px` violet 50 % | `1px` crimson 62 % |
| composer fill | `#2e1065` @ 22 % wash | `#1a0208` warm black |
| left rule (inset shadow) | **2 px** violet 85 % | **3 px** crimson 100 % |
| mode-header bar | transparent | crimson 9 % wash + crimson hairline |
| header sentence | `MessageCircleQuestion` "Nothing is recorded" `#a99ee0` | `Lock` "Sending records your answer — no undo" `#ffb3bd` |
| active segment | violet-deep fill + violet border, `violet-200` text | crimson fill + crimson border, white text |
| textarea placeholder | "Ask the specialist…" `#8b85b8` | "Write your answer…" `#ffb3bd` @ 70 % |
| send button | **outline** violet, `MessageCircleQuestion`, label **Ask** | **solid** `#d61f2c`, `SendHorizontal`, label **Record** |
| focus ring | violet 40 % | crimson 45 % |

Non-colour cues: rule width 2→3 px, button outline→solid, header transparent→washed, and words +
icons change (Advisory/Answer, Ask/Record, MessageCircleQuestion/Lock/SendHorizontal). Under
`prefers-contrast: more` the two borders go to full-opacity tokens; nothing depends on hue alone.

**Why asymmetric weight (quiet vs loud) and not two equal skins:** the safe mode is the resting state
and should not shout; the irreversible mode is exceptional and short-lived (it disarms after one
send), so the loud skin doubles as the "you are armed" alarm. Equal-weight skins would re-create the
original symmetry problem in a new form.

**Contrast (computed):** `#a99ee0` on the advisory bar ≈ **8.0:1**; `#ffb3bd` on `#1a0208` ≈ **11.3:1**;
white on `#d61f2c` ≈ **5.15:1**; `violet-200` on `#2e1065`/90 ≈ **11.3:1**; placeholder `#8b85b8` ≈ **5.7:1**.
Disabled send (45 % opacity) is exempt but still carries the label change.

### 2b.4 Reset rule — *the mode belongs to the unsent draft*

User proposal: *"mode returns to advisory after every send and on question switch; answer mode is
opt-in per message."* **Agreed, and tightened** so that no path can leave the composer armed while the
user is thinking about something else:

| # | Rule |
|---|---|
| R1 | Mode is **advisory** on mount, on panel reopen, on every question switch, and after **every** send (ask or answer). |
| R2 | Never persisted (no `localStorage` key; unlike drafts, `starn.questionDrafts.v1` is untouched). |
| R3 | Mode is bound to the **unsent draft**: switching mode keeps the draft; discarding the draft (Esc) also returns to advisory. |
| R4 | **No idle timer.** (See the rejected alternative below.) |
| R5 | Answer send **fails** → mode returns to advisory, draft is kept, `role=alert` card with **Retry as answer** (re-arms + re-sends, 44 px). |
| R6 | Answer recorded/queued → composer is replaced by the locked row (§4.3), so the mode is moot; when a composer returns it is advisory. |
| R7 | Conclude-from-chat, proposal accept/edit/reject and Ask-in-flight never change the mode. |

**Rejected: idle auto-disarm (e.g. 60 s).** Failure scenario: the user arms Answer, writes a
paragraph for three minutes, the timer flips the skin back to violet *while their eyes are on the
text*, they press Enter, and the decision goes out as an **Ask**. The specialist then replies
"nothing is recorded yet" — the mirror image of the original bug, and worse, because the user believes
they recorded something. Any silent state change is disqualified; only the draft's own lifecycle may
disarm.

**Rejected: persist the mode across questions or sessions.** Stale arming — the next question's
composer would open crimson and one Enter records the wrong thing.

**Rejected: remember the mode per question.** Same stale-arming risk across a chip switch, and it
breaks the one-decision-one-deliberate-act rule.

### 2b.5 Keyboard (replaces the §5 Enter rows)

| Key | Action |
|---|---|
| `Enter` | Send **in the visible mode** (advisory → Ask; answer → Record). Ignored when empty/busy/`isComposing`. |
| `Shift + Enter` | newline |
| `Alt + A` | toggle the mode (visible skin + live-region announcement). No send. |
| `←`/`→` on the segment | switch mode (roving `tabindex`, radios) |
| `Esc` (existing owner) | 1) cancel proposal-edit → 2) clear draft **and return to advisory** → 3) close panel |

**`Ctrl/Cmd+Enter` = send-as-answer is withdrawn.** A shortcut that records while the composer is
visibly violet would break the single invariant E is built on ("the skin says what Enter does").
`Alt+A` replaces it: it changes the *visible* state, then Enter sends.

### 2b.6 Geometry (measured in the rev-2 mockup, `getBoundingClientRect`)

| State (1280×720, pane 639, container 615) | Region | Memo body | Note |
|---|---|---|---|
| Rest, advisory | **141 px** | **417 px** | 6 pad + 24 label + 4 + composer 98 + 8 pad + 1 border |
| Rest, answer | 141 px | 417 px | identical geometry — **no layout shift on toggle** |
| Answer + typing (3 lines) | ~183 px | 200 px floor | textarea autosizes; memo floor wins |
| Thread open | 332 px | 211 px | head 44 + log 176 + composer 98 + 14 |
| 900×720 (pane 450, container 425) | 332 px | 202 px | seg 159 px + textarea 260 px + send 87 px; `scrollWidth == innerWidth` |
| 330 px container (phone drawer) | — | — | mode header stays one line (short sentence), input row wraps: textarea full width, then `mic … Record` |

**Changes vs rev 1:** rest region 93 → **141 px** (the mode header costs 40 px + 8 px of padding; the
memo keeps 417 px, still 58 % below the 332 px baseline). Log cap `clamp(96px,28vh,192px)` →
**`clamp(96px,26vh,176px)`** so the thread-open memo stays ≥ 200 px at 720. Memo floor 200 px,
`min-h-[96px]` log and "log shrinks first" are unchanged. Composer internals: mode header `min-h-[40px]`,
textarea `44→122px`, send/mic 44 px.

### 2b.7 Exact recipes — Advisory skin (Tailwind, tokens from §7)

```
composer  rounded-[10px] border border-[#8b5cf6]/50 bg-[#2e1065]/[.22] overflow-hidden mt-1
          shadow-[inset_2px_0_0_0_rgba(139,92,246,.85)]
header    flex items-center gap-2 min-h-[40px] px-2 bg-transparent border-b border-[#8b5cf6]/25
hint      text-[11px] font-semibold text-[#a99ee0] ml-auto truncate   (≥471px container: full sentence)
segment   inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-white/10 bg-black/35
seg-btn   relative h-[30px] px-2.5 rounded-md text-[11px] font-semibold inline-flex items-center gap-1.5
          text-[var(--sf-text-2)] after:absolute after:inset-x-0 after:-inset-y-[7px]   /* 44px target */
seg-on    border-[#8b5cf6]/75 bg-[#2e1065]/90 text-violet-200                          /* aria-checked=true */
textarea  border-[#8b5cf6]/40 bg-[#05070c]/75 placeholder:text-[#8b85b8]
          focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#8b5cf6]/40
send      border-[#8b5cf6]/60 bg-[#2e1065]/45 text-violet-200 hover:bg-[#3b1d7a]/60
          [MessageCircleQuestion] Ask
```

### 2b.8 Exact recipes — Answer skin

```
composer  rounded-[10px] border border-[#ff2a3c]/60 bg-[#1a0208] overflow-hidden mt-1
          shadow-[inset_3px_0_0_0_#ff2a3c,0_0_0_1px_rgba(255,42,60,.18),0_4px_16px_rgba(255,42,60,.10)]
header    bg-[#ff2a3c]/[.09] border-b border-[#ff2a3c]/35
hint      text-[11px] font-semibold text-[#ffb3bd]   ("Sending records your answer — no undo" /
                                                     ≤470px container: "Records — no undo")
seg-on    border-[#ff2a3c]/75 bg-[#d61f2c]/85 text-white
          [Lock] Answer
textarea  border-[#ff2a3c]/45 bg-[#0b0104] placeholder:text-[#ffb3bd]/70
          focus:border-[#ff2a3c] focus:ring-2 focus:ring-[#ff2a3c]/45
textarea label  sr-only "Your answer"   (advisory: sr-only "Question or note")
send      border-rose-700/50 bg-[var(--sf-power-btn)] text-white hover:bg-[#e11d3f]
          shadow-[0_2px_12px_rgba(255,42,60,.28)]   [SendHorizontal] Record
```

Shared: `disabled:opacity-45 disabled:cursor-not-allowed` on send; no transition on any of these
properties (instant flip, reduced-motion-safe by construction); the mode change is announced once by
a `role="status"` sr-only line — *"Advisory mode. Nothing is recorded."* / *"Answer mode. Sending
records your answer."*; the textarea `aria-describedby` points at the full contract (both modes, the
reset rule, Shift+Enter).

### 2b.9 What else changes in this record

- **§5 keyboard table**: Enter = send in visible mode; `Alt+A` toggles; `Ctrl/Cmd+Enter` withdrawn.
- **§7 composer row recipe**: replaced by 2b.7/2b.8 (one box with a header row instead of a bare textarea).
- **§8 DO-NOT 2 and 3**: rewritten (a mode is now allowed, but only the §2b form; bare Enter may record
  **only** when the composer visibly says Answer).
- **§9 QA**: adds mode checks 10–15.
- **§6 removal list**: unchanged — the second textarea and its `threadDrafts` store still go away.
- **Backend contract unchanged** (§10): an Ask still never records; an Answer still feeds the thread.

## 3. Layout & geometry (recipes in §7)

**Measured in the mockup** (`getBoundingClientRect`, 1280×720, panel 664 px; header+chips ≈ 106 px):

| State | Chat region | Memo body | Notes |
|---|---|---|---|
| Rest, empty thread | **93 px** (was 332) | 465 px | 6 pad + 24 label + 4 + 50 composer + 8 pad + 1 border |
| Typing, 6 lines | ≤ 165 px | ≥ 390 px | textarea grows to 122 px max, then scrolls |
| History, collapsed | 107 px | ~450 px | label row becomes a 44 px toggle |
| Thread open | 299 px | 259 px | log cap `clamp(96px, 28vh, 192px)` |
| Proposal pending | 358 px (1280) / 333 px (900) | **200 px floor** | log cap `clamp(120px, 40vh, 264px)`; body floor wins |

> **Rev 2:** every row above gains **+48 px** of region height and loses it from the memo (the §2b.2
> mode header). Measured rev-2 values: rest **141 / 417**, thread open **332 / 211**, 900 px **332 / 202**.
> The log cap drops to `clamp(96px,26vh,176px)` to pay for it. See §2b.6.

**Hard rule:** memo body is `flex-1 min-h-[200px]`; the log is `shrink min-h-[96px]`. If they can't both fit (viewport < ~600 px tall) the log shrinks first, never the memo. At 720 px tall the BLUF stays fully visible in every state (see `unified-chat-proposal-*.png`).

### 3.1 Placement: drawer between memo and composer (not inside the memo scroller)
The log sits directly above the composer: chat-native (newest message next to the input), and auto-scroll can't fight the memo scroll.
Rejected: appending the thread to the memo body — each reply would scroll the memo away (violates "memo never squeezed") and the user loses the BLUF exactly when comparing it to the discussion.

### 3.2 States (ASCII; pixel-true versions in the PNGs)

**S1 Rest / empty (93 px)**
```
 [msg] Conversation about Fuse selectivity (coordination) decision
 ┌──────────────────────────────────────┐ (mic) [? Ask  Enter] [> Answer Ctrl+Enter]
 │ Ask the specialist, or write your    │       (both verbs disabled until text)
 │ answer…                              │
 └──────────────────────────────────────┘
```
Label row is *non-interactive text* here (24 px). No thread UI, no empty-state box, no "Advisory only" prose.

**S2 Typing:** textarea autosizes 2→6 lines (`min 50px`, `max 122px`), then scrolls. Verbs enable when `trim()` ≠ ''. Region grows **upward**; memo gives up pixels (floor 200).

**S3 Has history, collapsed** (default when switching to a question that has a thread)
```
 [msg] Conversation about Fuse selectivity (coordination) deci…  [msg 4] [^]  [= Conclude from chat]
 ┌ Reply, or write your answer — the agent reads this conversation ┐ (mic) [Ask] [Answer]
```
The label row is now ONE `<button aria-expanded>` 44 px tall, plus the Conclude button 44 px.

**S4 Thread open:** log between label row and composer. Row types:
- user **Ask** → right-aligned violet bubble, sr-only prefix "You asked:".
- **Specialist** → left, `SPECIALIST` caps label (violet-300), `text-[13px]`, `max-w-[62ch]`.
- **Recorded answer** → full-width crimson-ruled card (§4.3).
- **Proposal** → violet card (§4.4).

**S5 In-flight (Ask):** user bubble appended optimistically; below it a `role=status` row `[spinner] Specialist is replying…`. Ask shows a spinner and is disabled; Answer disabled; **textarea stays editable**. Conclude hidden while in flight.

**S6 Error:** `role=alert` rose card *in the log under the failed message*: `[warn] Couldn't get a reply. Your message is saved. [Retry]`. Draft is NOT cleared on failure (mirror `handleSubmit`). Answer failure keeps the existing `submitError` alert, rendered as the last log row (or directly above the composer if the log is collapsed).

**S7 Proposal pending:** card is the last log entry; log scrolls so the card is fully visible. Composer stays usable: typing + **Answer** supersedes the proposal (`status:'superseded'`, polite announcement "Proposal replaced by your answer").

**S8 Edit proposal:** card text becomes a `textarea` (`min-h 72px`, sr-only label "Edit proposal") + `Use edited answer` / `Cancel`. Focus → that textarea. Esc cancels the edit first (§5).

**S9 Recorded / queued:** `Recorded answer` card appended with the state chip (reuse `stateChip`: Queued / Applying… / Applied / Couldn't apply + Retry). Composer replaced by one 52 px locked row `[lock] Answer recorded — applies after this phase`. Thread remains readable.

**S10 Resolved (8 s dwell):** locked row `[check] Resolved` (icon, **no `✓` glyph**). **Auto-applied:** locked row with existing copy + `Undo` (44 px).

**S11 Disabled / unavailable**
- `onThreadMessage` absent → Ask and Conclude not rendered; Enter = Answer (legacy behavior); single "Answer" button.
- Item `parked` → no region (as today).
- Ask in flight → verbs disabled, textarea enabled. API error → S6.
- Answer `queued`/`applying` → S9 locked row.

---

## 4. Components, data & behavior

### 4.1 File structure (flat)
```
web/src/components/question-chat/
  QuestionChat.tsx      // <section aria-label="Conversation about {title}"> composes the parts below
  ChatHeader.tsx        // label row / toggle button / count / Conclude
  ChatLog.tsx           // role=log list + ThreadMessage variants (ask, specialist, recorded, status, error)
  ChatComposer.tsx      // textarea + VoicePill + Ask + Answer + locked-row variants
  ProposalCard.tsx      // EXTRACTED from QuestionPanel's research proposal — shared by both variants
  useAutosizeTextarea.ts
```
`QuestionPanel.tsx` keeps: nav chips, memo, drafts store, answer states, the Esc owner. It renders `<QuestionChat/>` instead of `{composer}{threadPanel}` and drops the `<footer>` wrapper (`QuestionChat` *is* the footer: `border-t`, `shrink`).

### 4.2 Data shapes (mirror in `src/workspace/types.ts` and `web/src/types/api.ts`)
```ts
export type ThreadIntent = 'ask' | 'answer';

export interface PortalThreadMessage {
  role: 'user' | 'specialist';
  text: string;
  ts: number;
  /** user messages: 'ask' (default for legacy rows) | 'answer'. */
  intent?: ThreadIntent;
  /** absent => 'message'. 'recorded' = committed answer; 'proposal' = concluded draft. */
  kind?: 'message' | 'recorded' | 'proposal';
  /** kind === 'proposal' only */
  proposal?: {
    status: 'pending' | 'accepted' | 'rejected' | 'superseded';
    basedOn: number;      // messages the draft was built from ("Based on 4 messages")
    text: string;         // the drafted answer text the user accepts or edits
    editedText?: string;  // set when the user used Edit
  };
}
```
Recorded entry = `{ role:'user', intent:'answer', kind:'recorded', text, ts }`. Its **live phase** comes from `answerStates[id]` (queued/applying/applied/failed), not stored per row.

New / changed `QuestionPanel` props:
```ts
onThreadMessage?: (id: string, text: string) => Promise<void>;            // intent 'ask' (unchanged signature)
onConcludeThread?: (id: string) => Promise<void>;                         // server appends a kind:'proposal' row
onConfirmThreadProposal?: (id: string, proposalTs: number, editedText?: string) => Promise<void>;
onRejectThreadProposal?: (id: string, proposalTs: number) => Promise<void>;
// Answer intent keeps using onSubmit(id, text); the server MUST attach the full thread to the answering-agent prompt.
```
`ProposalCard` props: `{ variant: 'research' | 'conclusion'; title: string; text: string; meta?: string; sources?: ResearchSource[]; rationale?: string; editing: boolean; busy: boolean; error?: string; onUse(): void; onEdit(): void; onReject(): void; onSaveEdit(text: string): void; onCancelEdit(): void }`. Identical labels in both variants: **Use proposal / Edit / Reject** (YES/EDIT/NO); edit path **Use edited answer / Cancel**. Raise all four to `min-h-[44px]` (current 32 px buttons are below the floor).

Conclusion title: `Proposed answer — from this conversation`; right-aligned meta `Based on N messages` (no invented confidence %).

### 4.3 Recorded answer bubble (locked, not color-only)
Full-width card (a different *shape* from right-aligned ask bubbles), 3 px crimson left rule, `Lock` icon + caps label **Recorded answer**, the text, then the state chip (`Clock3` Queued / `Loader2` Applying… / `Check` Applied / `TriangleAlert` Couldn't apply + Retry). Reuses the "applying" chip tokens: `border-[#ff2a3c]/45 bg-[#1a0208] text-[#ffb3bd]`.

### 4.4 Proposal card (same family as the research proposal)
`border border-[#8b5cf6]/50 bg-[#2e1065]/20 rounded-lg p-2.5` (identical to the research card at ≈ line 935) + `ListChecks` icon. Buttons: `Use proposal` (crimson solid) · `Edit` · `Reject`. One pending proposal at a time; a new `Conclude` supersedes (old row collapses to one muted line "Superseded proposal").

### 4.5 "Conclude from chat" reveal rule
- **Visible** only when: item is an open `question`, thread has **≥ 1 specialist reply**, no proposal is `pending`, no Ask in flight. No N-message gate (one exchange can be enough); never a disabled stub beforehand (dead controls are noise).
- Lives in the label row (right), 44 px, `ListChecks` + **Conclude from chat**; while the server drafts: `aria-busy="true"`, text `Drafting…`, spinner. The composer draft is **neither included nor cleared**.
- Error: `role=alert` card in the log with Retry (S6 recipe).
- Absent on parked / answered / auto-applied items.

### 4.6 Nav-chip "has conversation" indicator
Trailing pill inside the existing chip after the title: `MessageSquare` (10 px) + count — `h-[18px] rounded-full border px-1.5 text-[10px] font-bold tabular-nums`. With a pending proposal the icon becomes `ListChecks` and border/text go violet (shape change + hue, never hue alone). Count = user + specialist + recorded rows (not proposal/status rows). Screen reader: `<span className="sr-only"> 4 messages in conversation</span>` (or `, proposed answer waiting`) **inside the chip** — do NOT put an `aria-label` on the chip that hides the visible title. Title `max-w-[140px]` → `max-w-[112px]` when the pill shows. The active chip must `scrollIntoView({ inline: 'nearest' })` on change (the pill is clipped at 900 px otherwise — see `unified-chat-rest-900.png`).

### 4.7 Behavior contract
- **Siloing:** `<QuestionChat key={item.id}>`; log, expanded flag, edit state and scroll position are per item. No text carries between threads. One draft per item reuses `drafts` / `starn.questionDrafts.v1` → **delete `threadDrafts`**.
- **Expanded default:** collapsed on open/switch if history exists; auto-expands on any send, specialist reply, Conclude, or proposal arrival. Session-only (`Record<id, boolean>`).
- **Label:** `Conversation about {cleanQuestionTitle(item.title)}` (single-line truncate; full text in `title=` and in the section `aria-label`). No Q-number.
- **Optimistic user bubble** on Ask; on failure keep it, show S6 error, keep the draft.
- **Scroll:** log scrolls to end on a new row (`behavior:'smooth'` only if `!matchMedia('(prefers-reduced-motion: reduce)').matches`); a taller-than-log proposal scrolls so the card *top* is visible.

---

## 5. Interaction & accessibility

### Keyboard
| Key | Action |
|---|---|
| `Enter` | **Send in the visible mode** (§2b.5): advisory → Ask (nothing recorded); answer → Record. Ignored when empty / busy / `isComposing`. |
| `Alt + A` | Toggle composer mode (visible skin change + live announcement, never sends). Replaces rev 1's `Ctrl/Cmd+Enter`. |
| `←` / `→` | On the mode segment (radios, roving `tabindex`): switch mode. |
| `Shift + Enter` | newline |
| `Esc` (existing single window-level owner — extend it) | 1) cancel open proposal-edit → 2) clear non-empty draft → 3) close panel. Collapsing the log is toggle-only. |
| `Alt` hold | existing voice push-to-talk (appends to the same single draft) |
| `Tab` order | chips → memo actions → log toggle → Conclude → log (`tabindex=0`, scrollable) → card buttons → mode segment (one stop, roving) → textarea → mic → send |

The mode radios carry `aria-checked` + a `title` sentence (*"Advisory — the specialist replies, nothing is recorded"*, *"Answer — sending records your answer, no undo"*); the send button carries the mode's own `title` (*"Send as a question — nothing is recorded (Enter)"* / *"Record this as your answer — no undo (Enter)"*). Textarea `aria-describedby` → sr-only help: *"Advisory sends a question to the specialist and records nothing. Answer mode records your answer and cannot be undone. The mode returns to advisory after every send and when you switch question. Shift plus Enter adds a line."* Visible kbd chips are dropped (rev 2): with a mode, an `Enter` chip would have two meanings.

### Wording (visible text == accessible name)
- Buttons: **Ask** · **Answer** · **Conclude from chat** · **Use proposal** · **Edit** · **Reject** · **Use edited answer** · **Cancel** · **Retry** · **Undo**. Icon-only mic keeps `aria-label="Record answer"`.
- Placeholder (empty thread): *"Ask the specialist, or write your answer…"*; (with history): *"Reply, or write your answer — the agent reads this conversation"*.
- Textarea `<label>` is `sr-only` "Reply or answer". The visible "Your answer" label and "Usually 1–3 sentences" helper are removed.

### Focus management
- Open / switch question → focus textarea (existing §8.8 rule, unchanged).
- Toggle log → focus stays on the toggle (`aria-expanded`, `aria-controls="qc-log-{id}"`).
- Ask success → focus stays in textarea. Failure → focus stays; error is `role=alert`.
- Conclude → button `aria-busy`; when the proposal arrives focus moves to **Use proposal** only if focus is still on Conclude (or `body`); otherwise never steal focus. Edit → edit textarea; Cancel → back to **Edit**.
- Answer success → composer becomes the locked row; give it `tabIndex={-1}` and focus it (otherwise focus falls to `body`).

### Live regions
- Log: `role="log"` (implicit polite, `aria-relevant="additions"`), `aria-label="Conversation about {title}"`, remounted via `key={item.id}` so switching questions does **not** read history aloud.
- In-flight / drafting rows `role="status"`; errors `role="alert"`; proposal card `role="group" aria-label="Proposed answer"` (arrival announced through the log).
- Recorded-answer phase changes: `stateChip` text inside the card.

### Contrast (computed)
`#6e7d92` on `#0d1017` ≈ 4.5:1 → muted/non-essential only (placeholder, "Based on N messages"); **never** for actions. `#a8b3c4` on `#0d1017` ≈ 8.6:1. Violet-200 on `#2e1065/40` ≥ 9:1. `#ffb3bd` on `#1a0208` ≥ 10:1. Disabled verbs (45 % opacity) are exempt.

### Motion
Allowed: spinner (`motion-safe:animate-spin`; static glyph + text under reduced-motion) and the existing `animate-panel-in` (already disabled in `prefers-reduced-motion`). **No height/width animation** for expand/collapse or autosize (instant). Smooth scrolling off under reduced motion.

### Responsive
Layout reacts to the **region's** width (container query on the wrapper), not the viewport — the pane is 635 px at 1280 and 450 px at 900.
- `≥ 600px`: Ask/Answer show **icon + label + kbd chip**.
- `< 600px` (900 viewport): **text labels only** (no icon/kbd) → still ONE row; textarea ≈ 240 px; region still 93 px (`unified-chat-rest-900.png`).
- `< 400px` (phone drawer): composer wraps to two rows — textarea full width, then `[mic] … [Ask] [Answer]` (`min-w-[44px]`). ≈ 144 px at rest; memo floor still holds at 720 tall.
- Label truncates with ellipsis; **Conclude from chat** never shortens.

---

## 6. What to remove from the current UI (`QuestionPanel.tsx`)

1. `let composer` / `let threadPanel` and the `<footer className="max-h-[50%] … space-y-2 overflow-y-auto …">` wrapper + the F1 comment (≈ lines 678-1140, 1415-1425) → `<QuestionChat/>`.
2. The `Ask the specialist` heading, `Advisory only — your answer goes through the response fields.`, visible `Your answer` label, `Usually 1–3 sentences is enough.`.
3. `threadDrafts` state and its textarea (one draft per item). `handleThreadSubmit` stays, reading the shared draft.
4. `min-h-[96px] resize-y` answer textarea → autosizing 2→6 lines, `resize-none`.
5. `🎤 Recording…` emoji → lucide `Mic` + "Recording… (release Alt to send)". `Resolved ✓` → `Check` icon + "Resolved".
6. VoicePill's at-rest "Cancel" slide hint (render only while `recording`).
7. Inline research `proposal` JSX → `ProposalCard` (behavior unchanged; buttons → 44 px).
8. `max-h-56` thread `<ul>` → `ChatLog` (clamp cap, §3).

---

## 7. Exact recipes (move to `index.css` as `.qchat*`; mockup CSS is the reference; use `var(--sf-*)`)

New tokens in `:root` (aliases of values already hard-coded in QuestionPanel): `--sf-review:#8b5cf6; --sf-review-fill:#2e1065; --sf-record-fill:#1a0208;`

| Part | Recipe |
|---|---|
| `.qchat-wrap` | `container-type:inline-size; flex:0 1 auto; min-height:0` |
| `.qchat` | `border-t border-[var(--sf-border-weak)] bg-[var(--sf-panel)]/80 px-3 pt-1.5 pb-2 flex flex-col min-h-0` |
| label row (empty) | `min-h-[24px] text-[11px] text-[var(--sf-text-2)]`; title `<b>` `font-semibold text-[var(--sf-text)]` |
| label row (history) | toggle `min-h-[44px] -mt-1.5`; count pill `h-5 px-1.5 rounded-full border border-[var(--sf-border-strong)] bg-[var(--sf-raised)] text-[10px] font-bold tabular-nums` |
| Conclude | `min-h-[44px] px-3 rounded-lg border border-[var(--sf-review)]/60 bg-[var(--sf-review-fill)]/40 text-violet-200 text-xs font-semibold hover:bg-[#3b1d7a]/50` |
| log | `flex-1 min-h-[96px] max-h-[clamp(96px,28vh,192px)] overflow-y-auto space-y-2.5 -mx-1 px-1`; `.is-proposal` → `max-h-[clamp(120px,40vh,264px)]` |
| ask bubble | `max-w-[86%] rounded-[10px_10px_2px_10px] bg-[var(--sf-review-fill)]/40 px-2.5 py-1.5 text-[13px]` |
| specialist | label `text-[10px] font-bold uppercase tracking-wider text-violet-300`; body `text-[13px] text-[var(--sf-text-2)] max-w-[62ch]` |
| recorded | `rounded-lg border border-[#ff2a3c]/45 border-l-[3px] bg-[var(--sf-record-fill)] px-3 py-2`; label `text-[10px] font-bold uppercase tracking-wider text-[#ffb3bd]` + `Lock` 12 px |
| proposal | `rounded-lg border border-[var(--sf-review)]/50 bg-[var(--sf-review-fill)]/20 p-2.5` |
| composer (rev 2) | **replaced by §2b.7 (advisory) / §2b.8 (answer)** — one bordered box: `min-h-[40px]` mode header + input row; textarea `min-h-[44px] max-h-[122px] resize-none rounded-lg px-2.5 py-1 text-[13px]/[18px]`; mode-dependent border/fill/placeholder/focus ring |
| mode segment | `inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-white/10 bg-black/35`; btn `relative h-[30px] px-2.5 rounded-md text-[11px] font-semibold after:absolute after:inset-x-0 after:-inset-y-[7px]` (44 px effective) |
| send | `h-11 min-w-11 px-3 rounded-lg text-xs font-semibold` — advisory `border-[var(--sf-review)]/60 bg-[var(--sf-review-fill)]/45 text-violet-200` + `MessageCircleQuestion` + **Ask**; answer `border-rose-700/50 bg-[var(--sf-power-btn)] text-white` + `SendHorizontal` + **Record** |
| send disabled | `disabled:opacity-45 disabled:cursor-not-allowed` |
| locked row | `min-h-[52px] rounded-lg px-3 py-1.5 text-[13px] font-medium`; queued: `border-[#ff2a3c]/45 bg-[var(--sf-record-fill)] text-[#ffb3bd]` + `Lock`; resolved/auto: `border-[var(--sf-review)]/60 bg-[var(--sf-review-fill)]/40` + `Check` |
| nav-chip pill | `inline-flex items-center gap-[3px] h-[18px] px-1.5 rounded-full border border-[var(--sf-border-strong)] bg-[var(--sf-raised)] text-[10px] font-bold tabular-nums text-[var(--sf-text-2)]`; proposal: `border-[var(--sf-review)]/70 bg-[var(--sf-review-fill)]/55 text-violet-200` |

Icons (lucide-react 0.468 — presence verified): `MessageSquare`, `MessageCircleQuestion`, `SendHorizontal`, `ListChecks`, `Lock`, `Check`, `ChevronDown`, `ChevronUp`, `Loader2`, `Mic`, `TriangleAlert`, `RotateCcw`, `Clock3`, `X`.

---

## 8. Binding DO-NOT list

1. **No second text input** in the question card. One draft per question.
2. **No mode form other than §2b:** exactly ONE mode control, inside the composer header, two
   positions, always both visible. No tabs, no `Ask|Answer` *send* verbs side by side, no mode
   control in the panel header, no second input.
3. **Bare `Enter` must never record while the composer is visibly advisory.** Recording requires the
   visible Answer skin (crimson fill + 3 px rule + Record button). No keyboard path may record from
   the advisory skin (`Ctrl/Cmd+Enter` is withdrawn, §2b.5).
4. **No idle timer and no persistence for the mode** (§2b.4 R2/R4); it is bound to the unsent draft
   and resets after every send and on question switch.
5. **No Ask-intent reply may claim a decision was made/recorded** (backend prompt contract). UI never renders a "Recorded" marker for ask rows.
6. **No color-only meaning:** recorded = Lock + words + full-width card; proposal = ListChecks + words; conversation indicator = icon + number.
7. **Memo body ≥ 200 px** at 720 px viewport height in every state; thread/proposal give way, never the memo.
8. **No emoji or glyph-icons** (`🎤`, `✓`, `…` as loader). Lucide only; spinners behind `motion-safe:`.
9. **No blue/green** (DocDiff only). Violet = review/advice, crimson = commit, amber = needs-input, rose = error.
10. **No height/width animation** for drawer/autosize; no layout shift on state change (the mode toggle
    must not move the send button or resize the region — both skins share one geometry).
11. **No hover-only affordances;** targets ≥ 44 px (incl. proposal buttons, raised from 32 px, and the
    mode segments via their `after:` 44 px hit box) with ≥ 8 px gaps.
12. **No `aria-label` that differs from visible text** on labeled buttons; counts/state go in `sr-only` spans.
13. **No Q-number labels** (pager order ≠ chip order). Use the title.
14. **No heuristic "this looks like a question/answer" auto-routing.** The explicit mode is the safeguard.
15. **No auto-collapse** of the thread while the user is reading or typing; no hover auto-reveal.
16. No new npm dependency; reuse `VoicePill`, `lucide-react`, `motion`.

---

## 9. QA checklist (final gate / Playwright)

1. 1280×720, empty thread: `section[aria-label^="Conversation about"]` height ≤ 96 px; memo body ≥ 450 px.
2. 900×720: same; `documentElement.scrollWidth <= innerWidth`; verbs text-only; single composer row.
3. Seeded thread open: log ≤ 192 px, memo ≥ 200 px. Pending proposal: memo ≥ 200 px, all card buttons ≥ 44 px tall.
4. Enter sends `ask` only; Ctrl+Enter calls `onSubmit`; Shift+Enter adds a line; empty draft → both verbs disabled.
5. Switching chips swaps thread and label, focuses textarea, leaks no text across items.
6. Tab order as §5; Esc order edit → draft → close.
7. Reduced motion: no spinner rotation, no smooth scroll.
8. Nav chip: pill count correct, proposal icon swaps, sr-only text present, visible title unchanged.
9. No `🎤` / `✓` in the panel DOM; no "Cancel" hint at rest.
10. Mode control: exactly one `[role=radiogroup][aria-label="Composer mode"]` with two
    `[role=radio]`; exactly one `<textarea>` in the panel; `aria-checked` follows the visible skin.
11. Toggle 20×: the composer's `getBoundingClientRect()` (height, and the send button's x/y) must be
    **identical** in both modes — no layout shift; only colours/shadow/labels change.
12. Skin assertion (computed style, not a screenshot): advisory border `rgba(139,92,246,.5)` +
    send `rgb(46,16,101)/45` outline; answer border `rgba(255,42,60,.6)` + send `rgb(214,31,44)` solid.
    Both must differ in **≥ 3 channels** (border, fill, left-rule width, label text).
13. Reset rule: after an Ask send, after a Record send, after a chip switch and after Esc-clearing the
    draft, the mode is advisory. After a failed Answer send: advisory + draft kept + `Retry as answer`.
14. Keyboard: `Enter` in advisory calls `onThreadMessage` only; `Enter` in answer calls `onSubmit`
    only; `Alt+A` flips the radio without sending; no keystroke records from the advisory skin.
15. Reduced motion / no-JS: no transition on the mode skins (instant), mode announced once via
    `role=status`.

## 10. Open items for backend (parallel track)

- Ask-intent prompt must append the non-commit line (§2) and never emit "Decision confirmed".
- `conclude` appends a `kind:'proposal'` row; `confirm`/`reject` take `proposalTs`; confirm records through the existing answer queue and writes a `kind:'recorded'` row.
- Answering-agent prompt includes the item's whole thread.
- `meta.thread` is oldest-trimmed: never trim `recorded` / `proposal` rows.
