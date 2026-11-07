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

---

## 3b. Workspace layout (approved): conversation left, document/details right

*User decision (verbatim): "put the bluff at the very top of the chat window, as well as … that open
question subject and title. Then … all the details … can be optionally displayed on the right panel
where the document preview is. Or the document preview flashes to the spot … where the open question
occurred."* and *"I want the details when you switch the details about the open question to also still
include the title, the subject, and the bluff on the right (essentially all of the things with that
open question)."*

Evidence: `web/briefs/unified-chat-layout-mockup.html` (states `#chat` `#details` `#anchored`
`#otherdoc`) and the seven PNGs `unified-chat-layout-{chat,details,anchored,otherdoc}-{1280,900}.png`.
Numbers below are pixel scans of those PNGs (border-band and box-edge detection at 1280×720 and
900×720) plus CSS box arithmetic; "derived" marks the arithmetic ones.

**Supersedes:** §3.1 (the conversation is no longer a drawer between memo and composer — it is the
left pane's main body), §8.7 ("memo body ≥ 200 px" — there is no memo in the left pane any more), and
§9 items 1–3 (replaced by the geometry tables below).

### 3b.1 The layout

```
┌ top nav 56 ───────────────────────────────────────────────────────────────────┐
├──────────────────────────────┬──┬─────────────────────────────────────────────┤
│ LEFT — Questions from AI     │▐▐│ RIGHT — document workspace (md+)            │
│ [msg] Questions from AI  13  │▐▐│ [doc] Requirements Traceability Matrix  v3  │
│       [Research open q.] [x] │▐▐│        [Document│Details]   [Edit] [⋯]      │
│ ─────────────────────────────│▐▐│ ────────────────────────────────────────────│
│ ELECTRICAL (11)  ●chip ●chip…│▐▐│ DOCUMENT (default)                          │
│ ─────────────────────────────│▐▐│  sticky violet "Jumped to SS-04.e" strip    │
│ CONTEXT HEADER (never edits) │▐▐│  doc body; anchored row ringed + id marker  │
│  [ELECTRICAL] 3 of 13  from  │▐▐│                                             │
│  RTM.md · SS-04.e  [Details] │▐▐│ ── or ──                                    │
│  Fuse selectivity (coordina…)│▐▐│ DETAILS  ← the whole record, read-only      │
│  BLUF No formal selectivity… │▐▐│  meta · title · BLUF · findings · sources   │
│ ─────────────────────────────│▐▐│  · verification · background · suggestion   │
│ CONVERSATION (fills pane)    │▐▐│  · alternatives · defer · history · original│
│  [msg] Conversation · 4  ⌄   │▐▐│                                             │
│  ┌ log  flex-1  min-h-96 ─┐  │▐▐│                                             │
│  │ ask / specialist / rec │  │▐▐│                                             │
│  └────────────────────────┘  │▐▐│                                             │
│  [Advisory│Answer] hint      │▐▐│                                             │
│  [ textarea ][mic][ Rec ]    │▐▐│ ▐▐ = PaneSplitter (8 px, role=separator)    │
└──────────────────────────────┴──┴─────────────────────────────────────────────┘
```

- The composer is pinned to the **bottom of the left pane** (`mt-auto` on the composer when the log is
  absent), so the input never jumps when the first row arrives.
- Order is fixed: panel header → chips → context header → conversation. The left pane itself never
  scrolls; only the chips strip and the log do.
- The right pane has exactly **two** views and one switch. There is no third "memo" surface.

### 3b.2 Measured geometry (720 px tall; 50/50 split)

| Band | 1280 (panes 640/640) | 900 (panes 450/450) |
|---|---|---|
| top nav | 56 (measured, border at y=55) | 56 |
| left panel header | 60 (one row) | **85 → 60 after §3b.6(iii)** (wraps; border y=141) |
| chips row | 45 | 45 |
| **context header** | **83** (title 1 line + BLUF 1 line) | **100** (title clamped to 2 lines, BLUF 1 line) |
| conversation band (label+log+composer) | **476** (y=244…719) | **434** (y=286…719) |
| ├ inner after 6/8 padding | 462 (derived) | 420 (derived) |
| ├ composer, one textarea row | **97** (measured y=615…711 = 40 modebar + 56 input row + 2 borders) | 97 |
| ├ composer, textarea at 122 max | 176 (derived) | 176 |
| ├ label row (history / empty) | 44 / 24 (§3) | 44 / 24 |
| └ log, thread open idle | **317** (measured 316) | **275** (measured 275) |
| right pane header | **48** (`h-12`, measured y=56…103) | 48 |
| doc content width (table docs) | **584** (table measured x=668…1251) | **394** |
| doc reading measure (table-free doc) | `max-w-[72ch]` ≈ 510 → **510** ≈ 61 chars/line | width-bound **394** ≈ 56ch |
| details measure | **496** (`max-w-[70ch]`, card measured x=656…1151) | width-bound **418** (x=466…883) |

Conversation band by state (the band is fixed; **only the log gives**):

| State | Composer | Log @1280 | Log @900 |
|---|---|---|---|
| Rest, no thread | 97 | no log element; 337 px void above the composer | 295 void |
| Typing, 6-line textarea, thread open | 176 | 238 | 196 |
| Thread open, idle | 97 | 317 | 275 |
| Proposal pending | 97 | 317, scrolled so the card is fully visible | 275 |

**Hard rule (replaces §8.7):** the log is `flex-1 min-h-[96px]` and is the only band that shrinks; the
composer and the context header never shrink. Below ~600 px viewport height the log still keeps 96 px
and the context header clamps its BLUF to 1 line. At 720 px tall every state keeps ≥ 196 px of log at
900.

### 3b.3 Component mapping to this codebase

Current facts this maps onto: `web/src/views/DevelopmentView.tsx` renders both panes; the question
surface is the overlay `<div className="absolute inset-0 z-20 …">` inside the **left** `<section
aria-label="Agent conversation">` (~line 1124) and again at ~1390 (`{surface !== 'closed' &&
<QuestionPanel …>}`); the doc pane is the sibling `<section aria-label="Document workspace">` at ~1491
with `<header className="flex h-12 …">` at ~1511; `<PaneSplitter className="hidden lg:flex" …>` at
~1476; `QuestionPanel.tsx` renders header → chips → memo scroller (`min-h-0 flex-1 space-y-3
overflow-y-auto p-4`, ~line 1436) → `{aux}` → `{conversation}`.

1. **Left pane = chips + `QuestionContextHeader` + `QuestionChat`.** Delete the memo scroller
   (`{body}`) from the left pane. `QuestionPanel` renders, in order: the existing header (minus the
   `docPath` chip and the `N of M` pager — both move into the context header), the existing chips row
   (`groupPortalItemsByTopic` + `qchat-chip`, unchanged), `<QuestionContextHeader/>`, then
   `<QuestionChat className="flex-1"/>` with its composer at `mt-auto`.
2. **New files** (flat, §4.1 convention): `web/src/components/question-chat/QuestionContextHeader.tsx`,
   `web/src/components/question-chat/QuestionDetails.tsx`, and
   `web/src/components/RightPaneViewSwitch.tsx` (a doc-pane control, not chat).
3. **State lift.** `DevelopmentView` gains `const [rightView, setRightView] =
   useState<'doc' | 'details'>('doc')` and `const [detailsItem, setDetailsItem] =
   useState<PortalItem | null>(null)`. `QuestionPanel` gains `onActiveItemChange?: (item:
   PortalItem | null) => void`, emitted from the existing adoption effects (~376–413) next to
   `onFocusDocumentRef` — one emission per active-item change, no new state inside the panel.
4. **Right pane header** gains `<RightPaneViewSwitch value={rightView} onChange={setRightView}
   disabled={!detailsItem} />` in one slot: after the document-selector popover, before the action
   cluster. In `details` mode the left cluster swaps to a read-only line `[List] Details · 3 of 13 ·
   <question doc>` and `Attach / Refresh / Edit / Approve phase / Diff / version pill` are **not
   rendered** (verdict ii). Collapse/zen rail buttons stay.
5. **Right pane body.** The existing `<div className="relative min-h-0 min-w-0 flex-1">` keeps the
   document tree **mounted at all times** (`role="tabpanel" id="pane-doc"`) and gains a sibling
   `{rightView === 'details' && <div role="tabpanel" id="pane-details" aria-labelledby="tab-details"
   className="absolute inset-0 z-10 overflow-y-auto bg-[var(--sf-void)]"><QuestionDetails
   item={detailsItem}/></div>}`. While that overlay is up the doc wrapper gets `inert` +
   `aria-hidden="true"` (its controls leave the tab order; its scroll and anchor ring survive).
6. **What the memo becomes.** Everything currently in the card body moves, in this split:
   *to `QuestionDetails` (right pane)* — `meta.sections` (BLUF / findings / suggestion / alternatives /
   defer / background), the sources list, `detailView` (the `Original detail` / `Show full question`
   disclosure) and `meta.answerHistory` (the `Follow-up` disclosure). *Stays left* — the answer state
   chip (`renderStateChip`) and the parked `Resolve & Resume` / `Edit Manually` actions, which render
   as the last row of the conversation's banner slot; the `gaps` list, which stays in the left-pane
   card for `type === 'parked'` (parked items have no conversation, no context header and **no Details
   view** — `detailsItem` is only ever a `type === 'question'` item).
7. **`aux` (status banner + research `ProposalCard`) changes parent, not behaviour:** it renders as a
   `banner` slot *between* `ChatLog` and `ChatComposer` inside `QuestionChat` (`shrink-0`), so the
   proposal card and the recorded/resolved banner live in the conversation and the log gives up the
   height (the log is the shrink band).
8. **Breakpoint:** the doc pane and the splitter move from `lg` to `md` — `hidden lg:flex` →
   `hidden md:flex` on both (~1491 and ~1476). Without it, Details has no home at 900 and the layout
   falls back to the 44 px dock strip.

### 3b.4 `QuestionContextHeader` spec

Reference only, never editable; its one action is the Details switch.

| Slot | Recipe |
|---|---|
| wrapper | `<section aria-label="Question context" className="shrink-0 border-b border-[var(--sf-border-weak)] bg-[var(--sf-raised)]/55 px-3 pt-1.5 pb-2">` |
| meta row | `flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[10px] text-[var(--sf-text-mut)]` |
| topic tag | `shrink-0 rounded-full border border-[var(--sf-review)]/55 bg-[var(--sf-review-fill)]/50 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.06em] text-violet-200` — a **text** label, never colour-only; omitted when `meta.topic` is undefined |
| order chip | `tabular-nums` `{pagerIndex} of {items.length}` — this **is** the "Qn chip": `PortalItem.id` is an opaque portal id and §8.13 forbids invented Q-numbers |
| source | `truncate` `from <b className="font-semibold text-[var(--sf-text-2)]">{basename(docPath)}</b>` + `` ` · ${reqId}` `` where `reqId = extractRequirementIds(title + detail)[0]` |
| Details button | `ml-auto min-h-[28px] shrink-0 rounded-md border border-[var(--sf-review)]/55 bg-[var(--sf-review-fill)]/35 px-2 text-[10.5px] font-semibold text-violet-200` + `List` 10 px icon; visible text `Details` == accessible name |
| title | `<h2 className="mt-0.5 line-clamp-2 text-[13px]/[1.35] font-bold text-[var(--sf-text)]">` holding `cleanQuestionTitle(item.title)` (clamp, don't `truncate` — never ellipsis mid-word) |
| BLUF | `<p className="mt-1 line-clamp-2 text-[11.5px]/[1.4] text-[var(--sf-text-2)]"><b className="mr-1.5 text-[9.5px] font-bold tracking-[0.07em] text-[var(--sf-brass)]">BLUF</b>{bluf}</p>` |

**No BLUF → nothing.** No empty amber/brass box, no "No BLUF yet" placeholder, no skeleton, no
reserved height: the `<p>` is simply absent and the header is ~20 px shorter (83 → 63 at 1280; 100 → 83
at 900 with a 2-line title). The Details button stays — it is the only path to the record, and the
record itself degrades to the `Original detail` body plus the plain sentence *"No decision memo for
this question yet"* in `text-[var(--sf-text-mut)]` (never amber, never a card).

The header carries no long copy (≤ 2 lines title + ≤ 2 lines BLUF), so it can never squeeze the log;
it is `shrink-0` by design.

### 3b.5 `QuestionDetails` spec

A complete, self-contained record — readable with the left pane collapsed to its 44 px rail or with the
chat scrolled anywhere. `max-w-[70ch] px-4 py-3.5`; each section is `rounded-lg border
border-[var(--sf-border-weak)] bg-[var(--sf-panel)]/60 px-3 py-2` with a `text-[9.5px] font-bold
uppercase tracking-[0.07em] text-[var(--sf-text-mut)]` label. Reading order:

1. **Meta line** — topic tag, `3 of 13`, `from RTM.md · SS-04.e`, plus `Open document` (44 px) when
   `basename(item.docPath) !== selectedDocName`.
2. **Title** — `<h1>` at `text-[15px]/[1.3] font-bold`, `cleanQuestionTitle`, **not** clamped.
3. **BLUF** — reuse `.sf-bluf-callout` (brass 3 px rule) with the `BLUF` label and
   `text-[13px] font-bold` body. Omitted when absent.
4. **Research findings** (`meta.sections.findings`) — cited source names stay inline as written.
5. **Sources** — one row per `meta.proposedAnswer.sources` / `meta.autoApplied.sources` (`FileText`
   12 px + `title` + host of `url`), else the derived doc row `RTM.md · SS-04.e (source row)`. Rows are
   text, never icon-only.
6. **Verification status** — one sentence, derived, no new backend field: `researching` → *"Research in
   progress — nothing verified yet."*; `proposedAnswer` → *"Unverified proposal (N % confidence) —
   awaiting your decision in the conversation."*; `autoApplied` → *"Verified against N sources (N %
   confidence) — auto-applied."*; none → *"No verified external source — treat as uncorroborated. No
   confidence figure is shown."*
7. **Background** (`sections.background`, legacy *Why it matters*).
8. **Main suggestion** (`sections.suggestion`) in the highlighted variant — brass 3 px rule
   (`--sf-brass`, the memo's primary tone). **Not amber**: amber is reserved for needs-input (§8.9);
   the mockup's `#f59e0b` card is corrected here.
9. **Alternatives** (`sections.alternatives`).
10. **If deferred** (`sections.defer`).
11. **Answer history** (`meta.answerHistory`) — the existing `Follow-up` disclosure markup, oldest
    first, `min-h-[44px]` toggle.
12. **Original detail** — collapsed disclosure when `meta.sections` exists; the primary body when it
    does not.

**The BLUF appears twice on purpose** (context header + Details) and that duplication is a decision,
not an oversight: the header is the glance you need while typing (it must fit in 83–100 px), the
Details copy is the one you can read or screenshot without the chat; a cross-pane reference would break
the moment the left pane is a rail or the window is narrow, and two sentences are cheaper than a second
navigation step.

**Proposal and recorded-answer cards never appear in Details.** They are dialogue artifacts whose
buttons (`Use proposal` / `Edit` / `Reject` / `Retry` / `Undo`) act on the item's live send state; §2b
requires recording to go through the visible Answer skin in the composer, and Details may be showing
while `activeId` has moved on. They stay in the conversation (`ChatLog` rows + the `banner` slot).
Details contains at most three interactive elements: `Open document`, the `Follow-up` toggle and the
`Original detail` toggle.

### 3b.6 Verdicts

**(i) Toggle persistence and anchored restore.** Session state only: `rightView` lives in
`DevelopmentView`'s React state, is **not** persisted to `localStorage` (unlike
`starn.studio.splitPct` — the split is a workspace preference, this is a per-glance decision), is
retained across minimize→expand, and resets to `doc` when the panel closes. Switching back to Document
**restores the anchored position with no new code**, because the doc tree is never unmounted:
`applyAnchorHighlight` (`web/src/lib/requirementAnchor.ts:68`) writes ring classes + a marker span onto
the live DOM node and calls `scrollIntoView`, and DevelopmentView clears them only on a `[doc, editing,
surface]` change (~line 893). Therefore `rightView` must **not** be added to that effect's dependency
list, and the overlay technique — not `display:none`, which zeroes `scrollTop` and would drop the ring
— is mandatory. No refetch on toggle.

**(ii) Doc-pane actions in Details mode: hidden, not disabled.** They describe the document
(`Edit`/`Save`/`Cancel`, `Approve phase`, `Diff`, `Refresh`, `Attach`) and are up to five controls; at
900 the doc pane is 450 px, the selector takes ~200 and the switch ~150, leaving ~100 px — two of them
at most. A disabled cluster also reads as "temporarily unavailable" (a lie) and adds five dead tab
stops. Hidden: `Attach`, `Refresh`, `Edit`/`Save`/`Cancel`, `Approve phase`, `Diff`, and the
version/status pill (it labels a body that is not on screen). Kept: the view switch, `Open document`
(from the Details meta line), collapse/zen rail buttons. Nothing is lost — one click on `Document`
returns every control, and the doc keeps its unsaved-draft state because it was never unmounted.

**(iii) At 900 px everything fits — after two fixes.** Measured bands 85 + 45 + 100 = 230, leaving 434
for label + log + composer: log **275** with the 44 px label and the 97 px composer (measured), well
above the 96 px floor. The context header does **not** collapse to one line; it clamps its title to
2 lines (the +20 px that makes it 100 instead of 83) and its BLUF to 2 lines (1 line in the fixture).
Worst case — 2-line title **and** 2-line BLUF — is 117 px and still leaves 258 px of log. The real 900
regression is the *panel header*, 85 px because it wraps to two rows: that is paid for by moving the
`docPath` chip and the `N of M` pager into the context header (where they now live anyway), which
returns it to one 60 px row (**−25 px**); keep an icon-only `Research` button under
`@container (max-width:560px)` as the fallback. And the doc pane must exist at 900 at all —
`hidden lg:flex` → `hidden md:flex` (§3b.3.8), otherwise Details has no right-pane home at 900 and
would open as a stacked sheet instead.

**(iv) A chip whose question came from a different doc.** In **Document** mode the flash works today
and needs no change: `handleFocusDocument` (~line 918) awaits `selectPhaseByDocPath(item.docPath)`,
sets `highlight`, and the effect at ~886 re-runs because `selectedDocName` changed, so
`applyAnchorHighlight` flashes the row and the live region says *"Jumped to SS-04.e in RTM.md."*
Cross-doc presence cannot be checked before the target renders, so it already degrades honestly (falls
back to `ids[0]`, then to the "couldn't locate" sentence). In **Details** mode: **no navigation** — the
doc sits behind an inert overlay, so navigating it is invisible work and a wasted fetch, and it would
contradict the view the user just chose. Details updates instantly from `item.meta` (no doc needed);
the meta line shows `from BOM.md` + `Open document`, and that button does all three things at once —
navigate, flip `rightView` to `doc`, re-run the flash. The flash is deferred, never lost. Do not add
the mockup's loud cross-doc strip: the meta line carries the same fact.

**(v) What the right pane shows when the panel is closed: Document.** Rule: Details is *displayed* only
while `surface === 'open'`. `surface === 'minimized'` (the 44 px dock strip) shows Document too — there
is no left-pane context for a record — but the remembered value survives so `Expand questions` returns
to Details. `surface === 'closed'` resets `rightView` to `doc` and clears `detailsItem`, so the right
pane is never empty and never shows another question's record. If `detailsItem` becomes null while open
(last question dismissed, dwell-expired, or all items applied) the view is forced back to `doc`; the
switch itself is only rendered when a `type === 'question'` active item exists (`disabled={!detailsItem}`
is not enough — an inert segmented control is noise).

**(vi) Keyboard.** The switch is a **`tablist`**, not a radiogroup — it swaps *panels* (ARIA tabs
pattern), unlike the composer's radio *input mode* (§2b.2); same visual recipe, different semantics:
`role="tablist" aria-label="Right pane view"`, two `role="tab"` buttons with `aria-selected` and
`aria-controls="pane-doc|pane-details"`, plus **roving tabindex** (selected `0`, other `-1`) so the
group costs exactly **one** Tab stop. `←/→/Home/End` switch with **automatic activation** (both panels
are already mounted, so activation is free); no Enter/Space needed. DOM order puts it between the
document selector and the action cluster, so the path is: …left pane… → `PaneSplitter` (already
`tabIndex={0}`, `role="separator"`) → doc selector → **view switch** → (Document mode) attach →
refresh → Edit → Approve → Diff → collapse/zen → doc body. `inert` on the doc panel removes its own
controls from the order in Details mode, so nothing becomes "hidden but focusable". Second, shorter
path for a keyboard user already inside the conversation: the `Details` button in
`QuestionContextHeader` sits in the left-pane flow before the log; pressing it flips the right pane and
**does not move focus** (cross-pane focus stealing would break the composer order), announcing once
through the existing `DevelopmentView` `role="status"` region (*"Right pane: details for SS-04.e"*).
**No new global shortcut**: `Alt+A` is the composer mode, `Ctrl/Cmd+.` is already the autopilot toggle
(~line 594), and `Esc` already owns three duties in the left pane (§5) — Esc must not close Details;
the return is the `Document` tab or the same header button.

### 3b.7 Binding DO-NOT list (this section)

1. **Never unmount, `display:none` or re-fetch the document tree when Details is showing.** Overlay +
   `inert` only; the anchor ring, `scrollTop`, diff state and unsaved draft must survive, and
   `rightView` must never enter the `applyAnchorHighlight` effect's dependencies.
2. **Never put a recording/rejecting/editing action in Details or the context header.** Record through
   the composer's visible Answer skin (§2b); `Use proposal` / `Edit` / `Reject` / `Retry` / `Undo` stay
   in the conversation.
3. **No second copy of the memo and no second copy of the conversation.** BLUF is the only permitted
   duplication: no findings/background/suggestion text in the left pane, no thread rows in Details.
4. **No Q-numbers ("Q7") and no invented ids.** Identity = pager position (`3 of 13`) + requirement tag
   (`SS-04.e`) (§8.13).
5. **No empty state in the context header.** No reserved amber/brass box, no "No BLUF" placeholder, no
   skeleton when BLUF/sections are absent — the row disappears and the header shrinks.
6. **The right-pane view is not a stored preference.** Nothing in `localStorage`; after close it is
   Document; nothing auto-switches it on chip click or on a live update.

## 3c. Chat window (approved rev 3): the conversation fills the pane

*User decision (verbatim): "I think it should be like a chat window, very similar to how the user can
interact with the specialist developing documents, or how ChatGPT works … where it progressively
scrolls. The user can scroll up and down and see the chat history. That's what should be in the chat
panel and it should fill up that whole space. There should obviously be the bluff bar at the top as
well as the title of the open question. That whole panel should essentially be the chat window."* and
*"on the right panel the very far right side is cut off. The button that the user can click to edit the
actual document is cut off"*, *"I can no longer see that submenu bar where I can edit or click between
the open question details … I can't scroll back up"*, *"When I use the left panel and expand it to be
bigger, the text doesn't automatically adjust"*, *"I don't really like the 'Conclude from chat' button
… it also cuts into the space from the actual chat window."*

Evidence: `web/briefs/unified-chat-window-mockup.html` (states `#a` wide/advisory/scrolled-up and
`#b` narrow/answer/fold-menu-open) and `web/briefs/unified-chat-window-{1280,900}.png`. Numbers below
are measured in that mockup (`getBoundingClientRect`) and, for the "before" column, in the running app
(localhost:3000, 2026-11-07, question *Continuous current/power design limit — REOPENED /
UNRESOLVED*, thread of 6 rows).

**Supersedes:** §3b.1's conversation band (label row + `min-h-96` log), §3b.2's "Hard rule" and every
log-height row in its state table, §3b.3.1's component order *within* the conversation, §4.5
("Conclude from chat" reveal rule and placement), the `.qchat-log` / `.qchat-ask` /
`.qchat-specialist-body` recipes in §7 and MASTER.md, and §9 items that test the collapse toggle.

**The rule, in one sentence:** the left pane is a chat window — pinned panel header, pinned chips strip,
pinned question context header (title + BLUF), a conversation region that is `flex-1 min-h-0` with the
log as the only scrollable child filling all remaining height, and a pinned composer; nothing in the
pane scrolls except the log and the chips strip.

### 3c.1 Region spec and the flex chain (exact classes)

```
#question-panel            absolute inset-0 z-20 flex flex-col overflow-hidden   ← add overflow-hidden
├ header                   shrink-0                                              (61 px, §3b.6(iii))
├ chips scroller           shrink-0                                              (45 px, §3c.4)
├ QuestionContextHeader    shrink-0                                              (99–117 px, §3b.4)
├ QuestionChat  flex-1 min-h-0
│  └ .qchat                flex flex-1 min-h-0 flex-col  position:relative
│     ├ .qchat-logwrap     relative flex-1 min-h-0
│     │  ├ .qchat-log      h-full overflow-y-auto overscroll-contain           ← the ONLY scroller
│     │  │  └ .qchat-col   w-full max-w-[min(100%,72ch)] mx-auto flex flex-col gap-2.5
│     │  └ .qchat-jump     absolute bottom-2 left-1/2 -translate-x-1/2 (44 px) (§3c.3)
│     ├ {banner}           shrink-0                                              (§3b.3.7, unchanged)
│     └ ChatComposer       shrink-0 max-w-[min(100%,72ch)] mx-auto               (97–176 px)
```

- **`min-h-0` on every link** is the whole fix; `justify-content: flex-end` on `.qchat-wrap` is
  deleted (that is what floated the block to the bottom and left a 127 px void above it).
- `.qchat-log` loses `max-height: clamp(96px,26vh,176px)`, `min-height:96px` and the
  `.is-proposal` cap of `clamp(120px,40vh,264px)`. There is **no** log height cap and **no** log
  minimum: a 2-row thread shows 2 rows at the top of a full-height region (`margin: 0` on
  `.qchat-col`, not `margin: auto`), and the empty state lives inside the log so the pane never shows
  a bare void.
- The pane root gets `overflow-hidden` — today it reports `scrollWidth 674 / clientWidth 635` because
  `sr-only` spans inside the chips escape, which is the phantom sideways scroll the user reported as
  "the left panel gets cut off".

**What `ChatHeader`'s collapsed state becomes — deleted, not repurposed.**
`ChatHeader.tsx` + `ChatHeader.test.tsx` are removed. Gone with it: the `expanded` /
`onToggleExpanded` props, the parent's per-item `expandedByItem` session state, the auto-expand
`useEffect` in `QuestionChat` (§4.7's "auto-expand on new row"), the `qchat-label` row (24/44 px) and
the `qchat-count` pill. Rationale: a chat window has no collapsed thread; the toggle was the only way
to make a 176 px box useful. Its one remaining idea survives as `ChatJump` — a 44 px
`Jump to latest ↓` pill (§3c.3), *not* a toggle, and it only appears when the user has scrolled up.
The message count is not lost: the nav chip already carries `MessageSquare n` / `ListChecks n` per
question (§4.6), and a count in the panel would be a second place to keep in sync.

- **Empty thread** (no rows): the log shows one centred block, `text-[12px] leading-relaxed
  text-[var(--sf-text-mut)]`: **"No conversation yet."** / *"Ask the specialist below — nothing is
  recorded."* It scrolls away with the first row; there is no reserved height, no skeleton, no card.
- The composer's placeholder already states the mode (`Ask the specialist…` / `Write your answer…`),
  so the empty state adds one sentence and no control.

### 3c.2 Measured geometry (720 px viewport; split 50/50)

| Band | 1280 (panes 636/636) | 900 (panes 446/446) |
|---|---|---|
| top nav | 56 | 56 |
| panel header | 61 | 61 |
| chips row | 45 (`scrollWidth 1376`) | 45 (`scrollWidth 1376`) |
| context header | 99 (title 1 line + BLUF 2 lines) | **116** (title clamps to 2 lines + BLUF 2 lines) |
| conversation band | 459 | 442 |
| **log (this section)** | **343** (content 580) | **326** (content 638) |
| **log (before §3c)** | 176 (content 747) + 44 label + 127 void | 176 (content 767) + 44 + 127 |
| composer, one textarea row | 98 (40 mode bar + 56 input row + 2 border) | 98 |
| composer, 6-line draft (122 px textarea) | 176 | 176 |
| right-pane header | 48, no overflow (`scrollWidth 636 = clientWidth 636`) | 48, no overflow (`446 = 446`) |

**Gain: +167 px of conversation at 1280 (+1.95×), +150 px at 900** — and the 127 px void is gone.
The worst case (2-line title **and** 2-line BLUF, 117 px header) still leaves 326 / 308 px of log.
Below 600 px viewport height the composer and context header still never shrink; the log keeps
`flex-1` and simply gets shorter. **Hard rule (replaces §3b.2's):** the log is the only band that
gives up height; the context header, chips strip and composer are `shrink-0` and have no caps.

### 3c.3 New-message behaviour (progressive scroll, never yank)

```ts
const stickRef = useRef(true);                       // was the log at the bottom, before this change?
const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
```

- `scroll` on the log updates `stickRef.current = atBottom(el)` (and hides the pill).
- On **row growth** (`messages.length` up, `busy` "Specialist is replying…" row appearing, pending
  proposal arriving): if `stickRef.current` → `scrollTo({top: scrollHeight, behavior: reduced ?
  'auto' : 'smooth'})`; **otherwise nothing moves** and `unseen += delta`. This is the fix for "I
  can't scroll back up": today `ChatLog`'s effect scrolls to the bottom on every `messages.length`
  change, i.e. every 3 s poll that carries a new row.
- On **question switch / first mount**: instant jump to the bottom (`behavior:'auto'`, `unseen = 0`) —
  a chat opens at its latest message, like every chat app.
- **`Jump to latest` pill** (`.qchat-jump`): `absolute bottom-2 left-1/2 -translate-x-1/2 z-10`,
  `min-h-[44px] rounded-full border border-[var(--sf-review)]/65 bg-[#150c2e] px-3.5
  text-[11.5px] font-semibold text-violet-200 shadow-lg`, `ArrowDown` 12 px + label + optional
  `min-w-[18px]` count badge; shown only when `!atBottom` (24 px threshold), click → smooth scroll to
  bottom, clear `unseen`, focus stays where it was. Copy variants: `2` new rows → *"Jump to latest ·
  2"*; a pending proposal → *"Proposed answer ready"*. It is a real button, 44 px, placed after the
  log in DOM order, so Tab reaches it before the composer.
- **Nothing else ever scrolls**: `overscroll-behavior: contain` on the log, `block:'nearest'` on every
  `scrollIntoView` in the pane, and the pill uses `scrollTop`, never `element.scrollIntoView()`.
- **Day/session separator — optional, not required.** When `meta.thread` spans more than one local
  calendar day, render one 24 px row (`Today`, `Fri 7 Nov`) as `text-[10px] font-semibold uppercase
  tracking-[.06em] text-[var(--sf-text-mut)]` with 1 px rules either side. Threads are session-scoped
  today, so it is normally absent; it must never be rendered as a card or pseudo-message.
- No virtualization: the server caps thread length; 40 rows render fine and anchor-scroll behaviour
  is easier to reason about without it. Revisit only if a thread exceeds a few hundred rows.

### 3c.4 Chips row: one 45 px horizontal scroller with an honest affordance

**Measured defect:** the row is `flex overflow-x-auto` and already scrollable, but the strip is
2542 px of chips in a 445 px pane with no fade, no chevron and no scrollbar — and nothing scrolls the
active chip into view. It reads as "the submenu bar is gone". (Two group divs measure 2095 px and
417 px; only the first group's first three chips are ever reachable by mouse.)

```jsx
<div className="relative shrink-0 border-b border-[var(--sf-border-weak)]">
  <div ref={stripRef} role="group" aria-label="Open questions" tabIndex={0}
       className="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain px-3 py-1.5
                  [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {/* groupPortalItemsByTopic(...) — unchanged; each chip keeps h-8 (min-h-[32px]) */}
  </div>
  {edge !== 'start' && (
    <button type="button" aria-label="Scroll questions left" onClick={() => nudge(-1)}
            className="absolute inset-y-0 left-0 z-10 flex w-12 items-center justify-center
                       bg-gradient-to-r from-[var(--sf-void)] via-[var(--sf-void)]/95 to-transparent
                       text-violet-200">…</button>)}
  {edge !== 'end' && ( /* same on the right: gradient-to-l + ChevronRight */ )}
</div>
```

- **Height is locked at 45 px**: 1 px `border-b` + `py-1.5` (6+6) + `h-8` chips = 45. Chips must keep a
  fixed `h-8` (never `py-1` on the chip, never `py-2` on the strip) so the conversation band does not
  shift when a chip gains a conversation pill.
- `edge` state = `'none' | 'start' | 'middle' | 'end'` from `scrollWidth <= clientWidth ? 'none'` and
  `scrollLeft` / `scrollLeft + clientWidth` against ±2 px, recomputed on `scroll` +
  `ResizeObserver`. The same value drives the CSS fade (`::before` / `::after`, 34/52 px) and the
  chevron buttons, so a side with no content never shows a fade or a control.
- **Keyboard:** the strip is `tabIndex={0}` with `role="group"` and a visible focus ring; the chevrons
  are real 44 px buttons in the tab order (`ArrowLeft/ArrowRight` stay with the chips themselves — no
  key hijacking on the strip). Native Home/End/arrow scrolling still works inside the strip.
- **Active chip always reachable:** `useEffect` on `activeId` →
  `chip.scrollIntoView({inline:'nearest', block:'nearest', behavior:'smooth'})`. `inline:'nearest'`
  moves the strip by the minimum and `block:'nearest'` guarantees the page/pane never scrolls.
- **Rejected:** (a) *wrap to 2–3 rows* — the row count depends on the question set (13 items today,
  40 later), so the conversation band would change height per project and the context header would
  jump; costs 45–90 px of log. (b) *a `<select>` / "jump to question" dropdown* — a second navigation
  model with a closed state, it hides the per-question conversation pill and the needs-input dot
  (§4.6) and shows one title at a time. (c) *chevron-only carousel* — loses wheel/trackpad
  directness and makes `scrollIntoView` fight the animation.

### 3c.5 Doc-pane header: a fold ladder that survives a 360 px pane

**Measured defect:** at 1280 the header's content is 726 px in a 636 px pane (the `Edit` button is cut
at the viewport edge); at 900 it is 497 in 446 (the `Diff` and version controls are gone). The cluster
is `flex-nowrap` with `shrink-0` members and the header has no overflow strategy. The full cluster
needs ~1090 px, so **folding is the normal state at every real width**, not an edge case.

Replace the `headerCompact` `ResizeObserver` (currently `w-10` on the selector with the status pill and
chevron still inside it — that spill is half the bug) with container queries on the doc pane:

```css
.docPane { container-type: inline-size; }
@container (max-width: 759px) { .docFold { display:none } }                              /* 1-4 */
@container (max-width: 629px) { .docRail { display:none } .docSelName { max-width:5rem } } /* 5 */
@container (max-width: 519px) { .docSelName, .docSelStatus, .docSelChev { display:none }
                                .docSel { width:44px; justify-content:center } }          /* 6 */
@container (max-width: 429px) { .viewswLabel { display:none } }                           /* 7 */
```

**Fold order — first to leave the inline row, last to return:**

| # | Control | Where it goes | When |
|---|---|---|---|
| 1 | `Attach a quality example` (Paperclip) | `⋯` | <=759 |
| 2 | `Refresh document` | `⋯` | <=759 |
| 3 | `Diff` (and `Toggle diff view`) | `⋯` | <=759 |
| 4 | `Approve phase` | `⋯` (row reads `Approve phase · v3`) | <=759 |
| 5 | `Collapse` / `Maximize` pane rail buttons | `⋯`; selector name narrows to 72 px | <=629 |
| 6 | selector document name + `Completed — needs approval` status pill | name folds; status words become a `⋯` line + a 6 px dot on the icon with the words in `title`/`aria-label` | <=519 |
| 7 | `Document` / `Details` visible labels | icons stay, `aria-label` + `title` carry the words | <=429 |

**Never folded (present at the splitter's 360 px floor):** `Edit` (icon + visible label down to 430,
icon + `aria-label`/`title` below), the `Document | Details` view switch, the `⋯` trigger itself, and
the document identity icon. Edit is the control the user reported losing, so it never moves behind a
menu — and while editing, the inline cluster is exactly `[Save][Cancel][⋯]` (Save/Cancel are modal and
never fold; Attach/Refresh/Approve/Diff are already in `⋯`).

- Measured after the ladder: **636 px pane** → icon 16 + selector 217 (name 104 + pill + chevron) +
  switch 168 + Edit 57 + `⋯` 36 + rail 36 + rail 36, right edge **1270 of 1280**, no overflow.
  **446 px pane** → selector 44 (name + status folded) + switch 168 (labels kept) + Edit 57 + `⋯` 36,
  no overflow (`scrollWidth 446 = clientWidth 446`). **360 px** → 44 + 76 (icon-only switch) + 57 + 36
  + gaps = 277 of 336. `Edit` survives in all three.
- All header controls keep a >=44 px effective target via
  `::after { position:absolute; inset:-4px -3px }` on a 36 px visual box (the pattern `.seg-btn`
  already uses), so the 48 px header does not grow.
- `⋯` is `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`; the panel is `role="menu"` with
  `role="menuitem"` buttons at `min-h-[44px]`, roving focus, `Esc` closes and returns focus, outside
  click closes. The status line inside it is a non-interactive `role="presentation"` row, **never** a
  disabled menuitem. The header itself gets `overflow-hidden` and `min-w-0` on its flex children so
  nothing can paint past the pane edge again.
- In **Details** mode the cluster is unchanged (§3b.6(ii): the document actions are not rendered;
  `⋯` disappears with them because nothing is folded into it; the switch and the rail buttons stay).

### 3c.6 Text reflow: width-relative measures, not `ch` on the row

**Measured defect:** `.qchat-specialist-body { max-width: 62ch }` resolves to 434.48 px inside a
619 px log and stays 434 px when the user widens the pane — "the text just stays contained in that tiny
section". `.qchat-ask { max-width: 86% }` on the *bubble* inside a padded row is unrelated to the
reading column and drifts as the pane changes.

- One wrapper owns the measure: `.qchat-col { width:100%; max-width: min(100%, 72ch);
  margin-inline:auto }`. Every row is a child, so bubbles, specialist bodies and cards share one edge.
- `.qchat-specialist-body { max-width: 100% }` (inherits the column) — no `ch` on the row.
- `.qchat-ask { max-width: min(88%, 60ch) }` — a bubble can never be wider than 60 characters of its
  own font even in an 1800 px pane, and never narrower than 88% of the column in a narrow one.
- `.qchat-composer { max-width: min(100%, 72ch); margin-inline:auto }` — input and transcript share the
  same column, so the composer does not stretch into a 900 px bar over a 520 px transcript.
- `72ch` at 13 px ≈ **520 px ≈ 78 average characters per line**: inside the readable band (45–75
  typical), and it only ever binds on wide panes. Long unbroken tokens (URLs, `SS-04.e`, hashes) get
  `overflow-wrap: anywhere`.
- **At 900 px** (446 px pane, 421 px inner): the 72ch cap never binds — every row is width-bound, i.e.
  visually identical to today — while the log is 326 px instead of 176 px. **At 1280** (636 px pane)
  the transcript becomes a 520 px centred column with ~58 px of gutter either side (vs. 434 px
  left-aligned today): text uses the widened pane up to the readable limit and stops.
- Recorded and proposal cards are full column width (`max-width:100%`) — they are artefacts, not prose.

### 3c.7 `Conclude from chat` moves into the composer (Answer skin)

**Measured defect:** the button is 153x44 px inside the 44 px label row, leaving 458 px of a 611 px row
for the label ("Conversation about Continuous curre…"), and it is not in the pane the user submits
from.

**Placement:** the composer's mode-header row, far right — the row that already holds
`[Advisory | Answer]` + the mode sentence. It is rendered **only in the Answer skin**; in Advisory it
does not exist, because concluding produces a proposed *answer*. The user's own framing — *"the user
can switch to 'Answer' or that button appears at the bottom where the user can submit answers"* — is
implemented as both: switch to Answer and it is there, at the submit area, 30 px above the textarea.

| Property | Rule |
|---|---|
| where | `.qc-modebar` → `ml-auto` slot after the mode sentence; `h-[30px]` + `::after{inset:-7px 0}` = 44 px target; `ListChecks` 12 px + `Conclude from chat` (>=560 px container) / `Conclude` (<=470; measured 88x30 in a 419 px mode bar at 900) |
| gate | `canConclude` — unchanged: >=1 specialist reply, no pending proposal, nothing in flight |
| while concluding | label `Drafting…` + spinner, `aria-busy="true"`, disabled |
| while a proposal is pending | not rendered (the card in the log owns *Use proposal / Edit / Reject*) |
| while drafting (non-empty textarea) | **visible but disabled** (`opacity-45`, `cursor-not-allowed`, `title` + `aria-describedby`: *"Clear the draft to draft an answer from the conversation."*) — same position, so typing never shifts the row |
| while the draft is empty | enabled; the crimson `Record` verb is disabled (nothing to record), so **exactly one verb is ever enabled** |
| height cost | **zero** — it lives inside the existing 40 px mode bar; the 44 px the label row used to take is returned to the log |
| keyboard | DOM order: seg → sentence → **Conclude** → textarea → mic → Record; `Alt+A` still flips the skin; no new shortcut |

**Why it cannot be confused with `Answer`:** the two verbs are never both enabled, they differ in hue
*and* word *and* placement (violet `Conclude` in the mode bar drafts text from the thread; crimson
`Record` in the input row commits what you typed, irreversible), and the Answer skin's permanent
sentence *"Sending records your answer — no undo"* still sits in the same row between them. Pressing
`Conclude` appends a `Proposed answer` card to the log (§4.4) and records nothing.

### 3c.8 What §3c overrides (explicit)

1. **§3b.1** — the ASCII's `Conversation · 4` label row and `log flex-1 min-h-96` box are deleted; the
   conversation is `.qchat` filling 459 / 442 px.
2. **§3b.2** — every log-height row of the state table and the "Hard rule (replaces §8.7)" are
   replaced by §3c.2. The "Rest, no thread … 337 px void above the composer" row describes a defect,
   not a state; it is removed (the empty state is in the log).
3. **§3b.3.1** — the render order stays (header → chips → context header → conversation) but
   `ChatHeader` leaves the conversation and `QuestionPanel` loses the `expanded` session state.
4. **§3b.3.7** — the `banner` slot is unchanged and still the last child before the composer.
5. **§4.5** — "Conclude from chat" is no longer revealed in the label row; see §3c.7.
6. **§7 / MASTER.md recipes** — `.qchat-log` loses `max-height` / `min-height`; `.qchat-ask` and
   `.qchat-specialist-body` take width-relative caps; `.qchat-col`, `.qchat-logwrap`, `.qchat-jump`,
   `.chips-wrap[data-edge]`, `.chips-next`, `.qc-conclude` are new.
7. **§9** — the collapse-toggle checks are replaced by §3c.9.
8. **Unchanged on purpose:** §2b mode skins and reset rules, §3b.4 context header, §3b.5 Details,
   §3b.6 verdicts (incl. the `inert` overlay rule), §4.3 recorded card, §4.4 proposal card, §4.6 chip
   pill, §3b.7's "no empty state in the context header" (the new empty state is in the log, not there).

### 3c.9 QA (Playwright, localhost:3000, 1280x720 and 900x720)

1. Left pane, thread open: `log.clientHeight >= 300` at both widths (was 176); `log.scrollHeight >
   log.clientHeight`; the log is the only element with `scrollTop > 0` after scrolling to history.
2. No element in `#question-panel` exceeds the pane: `pane.scrollWidth === pane.clientWidth`.
3. Submit a question while scrolled to the top of the log: `log.scrollTop` is **unchanged** afterwards
   and `Jump to latest` is visible; click it → `scrollTop` at max, pill hidden.
4. Submit while at the bottom → the new row is in view within one frame and the pill never appears.
5. Chips: `strip.scrollWidth > strip.clientWidth`; the right chevron is visible and clicking it moves
   `scrollLeft`; clicking a chip activates it and `scrollIntoView({inline:'nearest'})` leaves it fully
   inside the strip; the row's `getBoundingClientRect().height === 45` before and after a chip gains a
   conversation pill.
6. Doc header at 1280, 900 **and after dragging the splitter to its floor (~360)**: `header.scrollWidth
   === header.clientWidth`; `Edit` is visible with its right edge <= pane right - 8; the view switch is
   visible; `⋯` is visible; opening `⋯` at 360 lists Attach / Refresh / Diff / Approve / Collapse /
   Maximize / status, each >=44 px tall.
7. Widen the left pane to ~900: the specialist column is <= 76ch and centred, the composer shares the
   same width, and no horizontal scrollbar appears anywhere.
8. `Conclude from chat` exists only in the Answer skin, sits inside `.qc-composer`, and is never in the
   conversation label row or above the log; type one character → it is `disabled` and `Record` is
   enabled; clear the draft → the inverse; press it → a `Proposed answer` card appears in the log and
   `Record` is still disabled.
9. Keyboard: Tab path is chips strip → context `Details` → log → `Jump to latest` (when shown) → mode
   segments → Conclude → textarea → mic → send. No focus lands on a hidden control.

### 3c.10 Binding DO-NOT list (this section)

1. **No height cap, no `min-height` and no collapse toggle on the log.** No `expanded` state, no
   chevron in a label row, no second way to hide the transcript.
2. **Never auto-scroll when the user is not at the bottom.** The polling refresh must not move the
   view; only `Jump to latest` does, and only on click.
3. **Nothing but the log and the chips strip scrolls in the left pane** — no `overflow-y-auto` wrapper
   around the context header or the composer, and no `justify-content: flex-end` void.
4. **No horizontal clipping without an affordance.** Any `overflow-x: auto` surface gets an edge fade
   *and* a 44 px control; never rely on a hidden scrollbar.
5. **Never hide `Edit`, the `Document | Details` switch or `⋯`** at any pane width >= 360, and never
   let the doc header be wider than its pane.
6. **Never put a concluding or recording action in the label row, above the log, or on the side of the
   transcript.** Concluding lives in the composer's Answer skin only.
7. **No `ch`-capped row inside a percentage container.** Measures live on the column
   (`min(100%, 72ch)`); bubbles use `min(88%, 60ch)`.
8. **No `scrollIntoView()` without `block:'nearest'`** anywhere in this pane.
9. **No new dependency** for any of this: no virtualization, no scroll library, no menu library.
