# Unified Question Chat + Thread-Aware Incorporation + Header Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two stacked question-card input boxes (advisory chat + answer) with ONE per-question conversation whose Ask/Answer verbs are explicit, let the user conclude an answer from that conversation, and make the answering agent read the conversation when it rewrites the document — plus shorten question headers to number + topic + short question.

**Architecture:** Core stays I/O-agnostic: thread rows gain `intent`/`kind`/`proposal` fields in `src/workspace/types.ts`; the session owns three new read-only/serialized operations (conclude, confirm, reject) and one prompt-injection helper that both incorporation call sites consume. The web layer gains `web/src/components/question-chat/*` (flat component set) and `QuestionPanel` renders it in place of the old `composer`/`threadPanel` footer.

**Tech Stack:** TypeScript strict, Node HTTP server, React 19 + Vite + Tailwind, vitest (root + web), Playwright for the visual gate.

**Spec:** `docs/superpowers/designs/2026-11-03-unified-question-chat-design.md` (design record, mockups in `web/briefs/`), plus `docs/superpowers/plans/2026-11-02-header-cleanup-thread-incorporation-implementation.md` Part A/B (absorbed here).

## Global Constraints

- Core modules must not import terminal libraries or `cli/*`; presentation stays swappable.
- No new npm dependency. Lucide icons only, no emoji, no glyph-icons (`✓`, `🎤`).
- No blue/green except DocDiff rows. Violet = review/advice, crimson = commit, amber = needs-input, rose = error.
- No color-only meaning; targets ≥ 44px; `aria-label` must match visible copy.
- No persistent mode toggle, no tabs, no second text input in the question card.
- Bare `Enter` must never record an answer; only `Ctrl/Cmd+Enter` or the Answer button.
- Memo body `min-h-[200px]` at 720px viewport height in every chat state.
- Project docs `C:/Users/makel/OneDrive/Desktop/starn test/docs/REQUIREMENTS.md` and `docs/BOM.md` are untouchable: `git hash-object` before/after must be `0228ba30b66309b9d80ba4e832e81331beb140c8` / `88e7e63849b663fd379825aff630a4ca0e441f37`.
- Never run `npm install` or edit `package.json`/`package-lock.json`.
- `npx tsc --noEmit` must stay at 0 errors; run one vitest file per bash call.

## Decided Layout (user-approved, sketch: `.superpowers/brainstorm/559-1793987614/content/layout-sketch-v1.html`)

```
┌ LEFT PANE (53%) ───────────────────┬ RIGHT PANE ──────────────────────────┐
│ chips (question selector, + pill)  │ header: doc title  [Document|Details]│
│ CONTEXT HEADER: Qn chip, [TOPIC],  │ Document: today's doc view + anchor  │
│   title, 2-line amber BLUF         │   flash to where the question arose  │
│ conversation log (ask/specialist/  │ Details: the COMPLETE record — Qn,   │
│   proposal/recorded answer)        │   topic, title, BLUF, research,      │
│ composer + Ask/Answer mode control │   background, suggestion, alternates │
└────────────────────────────────────┴──────────────────────────────────────┘
```

- **Details mode is complete and self-contained** (title, subject, BLUF included) — the BLUF duplication with the chat context header is intentional, not a defect.
- Right-pane mode control lives in the **doc pane header**, not in the chat. Document mode keeps today's anchor-flash.
- Proposal + recorded answer live in the **conversation**, never in Details (they are dialogue, not reference).
- The memo no longer renders inside the left card; the left card keeps only the context header (title + BLUF clamp).

## File Structure

| File | Responsibility |
|---|---|
| `src/workspace/types.ts` | `ThreadIntent`, `kind`, `proposal` on `PortalThreadMessage` |
| `src/core/question-portal.ts` | thread append/trim rules (`recorded`/`proposal` rows never trimmed) |
| `src/core/incorporation-prompt.ts` | `buildIncorporationPrompt(phaseId, threadContext?)` + `collectThreadContext()` |
| `src/core/research-gate.ts` | `rewriteShortTitle` sentence-boundary cut |
| `src/specialists/open-questions.ts` | format-v2 header rule tightened (title = number + topic + short question); injected into every specialist prompt via `registry.ts` |
| `src/server/session.ts` | `postThreadMessage(intent)`, `concludeThread`, `confirmThreadProposal`, `rejectThreadProposal` |
| `src/server/routes/portal.ts` | `conclude-thread`, `confirm-thread-proposal`, `reject-thread-proposal` |
| `web/src/components/question-chat/QuestionChat.tsx` | composes header + log + composer for one item |
| `web/src/components/question-chat/ChatHeader.tsx` | label row / toggle / count / Conclude |
| `web/src/components/question-chat/ChatLog.tsx` | `role=log`, message variants |
| `web/src/components/question-chat/ChatComposer.tsx` | autosize textarea + mic + Ask + Answer + locked rows |
| `web/src/components/question-chat/ProposalCard.tsx` | shared research/conclusion proposal card |
| `web/src/components/question-chat/useAutosizeTextarea.ts` | 2→6 line growth |
| `web/src/components/QuestionPanel.tsx` | renders `<QuestionChat/>`, drops old footer and the in-card memo |
| `web/src/components/QuestionContextHeader.tsx` | Qn chip + topic + title + 2-line BLUF clamp |
| `web/src/components/DocPaneModeToggle.tsx` | `[Document | Details]` control in the doc pane header |
| `web/src/components/QuestionDetails.tsx` | complete read-only record for the right pane |
| `web/src/lib/portalGrouping.ts` | nav-chip conversation pill data |
| `web/src/index.css` | `.qchat*` recipes + 3 tokens |

---

## Task 1 — Header simplification (number + topic + short question only)

**Files:** `src/specialists/open-questions.ts` (rule text; injected globally via `src/specialists/registry.ts`), `src/core/research-gate.ts`, `tests/open-questions-format-v2.test.ts`, `tests/research-gate.test.ts`

**Why:** headers currently carry the explanation prose, so the card title is a wall of text and the memo repeats it.

- [ ] Add failing test in `tests/open-questions-format-v2.test.ts`: a Section-6 entry written as `**Q2. [ELECTRICAL] Main bus voltage?** Because the load profile and the cranking spec disagree, we need…` parses to `title === 'Q2. [ELECTRICAL] Main bus voltage?'` (explanation NOT in the title).
- [ ] Run it, confirm it fails.
- [ ] Tighten the format-v2 header rule in `src/specialists/open-questions.ts` (injected via `registry.ts`): header line is ONLY `**Qn. [TOPIC] <short question ≤ 90 chars, one sentence, ends with ?>**`; every explanation, background, and option belongs in BLUF / Research findings / Main suggestion / Alternatives / Defer.
- [ ] Add failing test in `tests/research-gate.test.ts`: `rewriteShortTitle` on a title whose first sentence is > 200 chars cuts at the first sentence boundary (`. ` / `? ` / `! `) within the first 120 chars, never mid-word, and keeps `meta.originalTitle`.
- [ ] Run it, confirm it fails; implement the sentence-boundary cut in `rewriteShortTitle` (`src/core/research-gate.ts`).
- [ ] Run `npx vitest run tests/open-questions-format-v2.test.ts` and `npx vitest run tests/research-gate.test.ts` → all pass.
- [ ] Commit: `feat(core): question header = number + topic + short question only`.

## Task 2 — Thread data model: intent, kind, proposal

**Files:** `src/workspace/types.ts`, `src/core/question-portal.ts`, `tests/question-portal.test.ts`

- [ ] Add failing test: appending rows past the cap trims the OLDEST `kind:'message'` rows first and never trims `kind:'recorded'` or `kind:'proposal'` rows; legacy rows without `intent` read as `'ask'`.
- [ ] Run it, confirm it fails.
- [ ] Extend `PortalThreadMessage` with `intent?: 'ask' | 'answer'`, `kind?: 'message' | 'recorded' | 'proposal'`, and `proposal?: { status: 'pending' | 'accepted' | 'rejected' | 'superseded'; basedOn: number; editedText?: string }` — comments copied from design §4.2.
- [ ] Implement the trim rule where thread rows are appended (`src/core/question-portal.ts`), keeping the existing 20-row cap for message rows only.
- [ ] Mirror the type in `web/src/types/api.ts`.
- [ ] Run `npx vitest run tests/question-portal.test.ts` → pass. `npx tsc --noEmit` → 0.
- [ ] Commit: `feat(core): thread rows carry intent/kind/proposal; recorded rows are never trimmed`.

## Task 3 — Thread-aware incorporation (the agent reads the conversation)

**Files:** `src/core/incorporation-prompt.ts`, `src/core/autopilot.ts` (~610), `src/core/answer-applier.ts` (~193), `tests/incorporation-prompt.test.ts`

- [ ] Add failing test: `buildIncorporationPrompt('rtm', 'USER: should I add selectivity?…')` contains an `## Advisory conversation with the user` block with the framing sentence "Inform the rewrite; do NOT contradict the explicit answers above."; with no thread context the prompt is byte-identical to today's output.
- [ ] Add failing test for `collectThreadContext(stateManager, phaseId)`: gathers items for that doc with non-empty `meta.thread` (open OR answered), renders the last 6–8 rows (user full, specialist truncated ~400 chars), whole block ≤ `THREAD_CONTEXT_CHAR_CAP = 3000`, drops whole lines when over.
- [ ] Add failing test: a thread already consumed for this phase (watermark `meta.threadConsumedBy`) is not injected twice; a thread inherited from `answerHistory` into a NEW question is not injected.
- [ ] Run the three tests, confirm they fail.
- [ ] Implement `collectThreadContext` + the optional second parameter in `buildIncorporationPrompt`; stamp `meta.threadConsumedBy = <phaseId:ts>` on injected items.
- [ ] Wire both call sites (`autopilot.ts:610`, `answer-applier.ts:193`).
- [ ] Assert in test that no thread text enters the pending block / `appendedText` (UNDO byte contract intact).
- [ ] Run `npx vitest run tests/incorporation-prompt.test.ts`, `npx vitest run tests/server-idle-incorporation.test.ts` → pass.
- [ ] Commit: `feat(core): advisory conversation reaches the specialist at incorporation`.

## Task 4 — Conclude-from-chat backend

**Files:** `src/server/session.ts`, `src/server/routes/portal.ts`, `tests/server-portal-thread.test.ts`

- [ ] Add failing tests: `postThreadMessage(id, text, 'answer')` appends `{ role:'user', intent:'answer', kind:'recorded' }`; `concludeThread(id)` runs ONE read-only specialist turn over the thread and appends a `kind:'proposal'` row with `basedOn = <row count>`, never writes a doc, and 409s while an Ask is in flight or when the thread has no specialist reply; `confirmThreadProposal(id, ts, editedText?)` records the answer through the existing answer queue and flips the row to `accepted`; `rejectThreadProposal` flips it to `rejected`; a new conclude supersedes a pending one.
- [ ] Run them, confirm they fail.
- [ ] Implement in `src/server/session.ts` reusing `ADVISORY_SYSTEM_DIRECTIVE` and the read-only allow-list; add the non-commit sentence requirement to the Ask-intent prompt ("Nothing is recorded yet — send it as your answer, or use Conclude from chat.") and forbid "Decision confirmed" in Ask replies.
- [ ] Add routes `conclude-thread`, `confirm-thread-proposal`, `reject-thread-proposal` in `src/server/routes/portal.ts` (mirroring the existing `confirm-proposal` shape; 404 unknown item, 409 no pending proposal / in flight).
- [ ] Run `npx vitest run tests/server-portal-thread.test.ts` → pass; `npx tsc --noEmit` → 0.
- [ ] Commit: `feat(core): conclude-from-chat proposal + confirm/reject routes`.

## Task 5 — Web: question-chat components (no wiring yet)

**Files:** `web/src/components/question-chat/*`, `web/src/index.css`, `web/src/components/question-chat/*.test.tsx`

- [ ] Add failing tests for `ChatComposer`: Enter fires `onAsk`, `Ctrl+Enter` fires `onAnswer`, `Shift+Enter` inserts a newline, empty draft disables both verbs, IME composition ignored.
- [ ] Add failing tests for `ChatHeader`: label reads `Conversation about <title>`; count pill counts user+specialist+recorded rows only; Conclude hidden until ≥1 specialist reply, hidden while busy; toggle is `aria-expanded` + `aria-controls`.
- [ ] Add failing tests for `ChatLog`: `role="log"`, recorded row renders `Lock` + words `Recorded answer` (not color-only), proposal row renders `ListChecks`, in-flight row is `role="status"`, error row is `role="alert"` with Retry.
- [ ] Add failing tests for `ProposalCard`: labels `Use proposal` / `Edit` / `Reject`; edit path shows `Use edited answer` / `Cancel`; all buttons ≥ 44px (`min-h-[44px]`).
- [ ] Run them, confirm they fail.
- [ ] Implement the five components + `useAutosizeTextarea` exactly per design §7 recipes; add `--sf-review`, `--sf-review-fill`, `--sf-record-fill` tokens and `.qchat*` recipes to `web/src/index.css`.
- [ ] Extract the existing research proposal JSX from `QuestionPanel.tsx` into `ProposalCard` (`variant: 'research'`) with behaviour unchanged.
- [ ] Run each new test file → pass.
- [ ] Commit: `feat(web): question-chat component set (header, log, composer, proposal card)`.

## Task 6 — Web: wire QuestionChat into QuestionPanel, delete the two boxes

**Files:** `web/src/components/QuestionPanel.tsx`, `web/src/lib/portalGrouping.ts`, `web/src/views/DevelopmentView.tsx`, `web/src/components/QuestionPanel.test.tsx`, `web/src/components/QuestionPanelThread.test.tsx`, `web/src/lib/portalGrouping.test.ts`

- [ ] Add failing test: the card renders exactly ONE textarea (`getAllByRole('textbox')` length 1) and no visible `Your answer` / `Ask the specialist` / `Advisory only` copy.
- [ ] Add failing test: switching the active chip swaps the conversation (no text from item A appears while item B is active).
- [ ] Add failing test: nav chip shows a pill with the conversation count and `sr-only` "N messages in conversation"; pending proposal swaps the icon to `ListChecks`.
- [ ] Run them, confirm they fail.
- [ ] Replace the `composer`/`threadPanel` footer with `<QuestionChat key={item.id} …/>`; delete `threadDrafts` (one draft per item via the existing drafts store), the F1 footer comment, the emoji/glyph strings per design §6.
- [ ] Wire the four new props (`onThreadMessage`, `onConcludeThread`, `onConfirmThreadProposal`, `onRejectThreadProposal`) through `DevelopmentView` to the API client routes from Task 4.
- [ ] Keep Esc order: cancel proposal edit → clear draft → close panel.
- [ ] Run `web/src/components/QuestionPanel.test.tsx`, `QuestionPanelThread.test.tsx`, `portalGrouping.test.ts`, `DevelopmentView.test.tsx` → pass.
- [ ] Commit: `feat(web): one per-question conversation replaces the answer + ask boxes`.

## Task 6b — Workspace layout: chat left, right pane toggles Document / Details

**Files:** `web/src/views/DevelopmentView.tsx`, `web/src/components/QuestionContextHeader.tsx`, `web/src/components/DocPaneModeToggle.tsx`, `web/src/components/QuestionDetails.tsx`, `web/src/components/Markdown.tsx` (reuse section renderer), tests alongside.

- [ ] Add failing tests: right pane renders `[Document | Details]` with `aria-pressed` state; switching to Details renders Qn chip + topic + title + BLUF + research findings + background + main suggestion + alternatives (all present, none truncated to zero); switching back to Document restores the document and the anchor flash.
- [ ] Add failing test: context header renders Qn chip, topic tag, title, and a BLUF clamped to 2 lines; expanding it switches the right pane to Details.
- [ ] Add failing test: Details never contains a proposal card or a recorded-answer card (those stay in the conversation).
- [ ] Run them, confirm they fail.
- [ ] Implement the toggle (state per active question, default Document; remember last mode per session) + `QuestionDetails` reusing the memo section data already on `item.meta.sections` and the research proposal sources.
- [ ] Move the memo out of the left card; keep the anchor-flash behaviour unchanged.
- [ ] Verify at 1280 and 900: left pane fits chips + context header + log + composer without wrapping to two rows; doc measure and bubble width unchanged.
- [ ] Commit: `feat(web): question workspace — conversation left, document/details toggle right`.

## Task 7 — Gates and visual verification

- [ ] `npx vitest run` (root) → record exact pass counts.
- [ ] `npm --prefix web run test` → record exact counts.
- [ ] `npx tsc --noEmit` → 0 errors.
- [ ] `npm --prefix web run build` → succeeds.
- [ ] `git hash-object` both project docs → unchanged.
- [ ] Playwright against a freshly restarted server, design §9 checklist: section height ≤ 96px at rest (1280 and 900), memo ≥ 200px with thread open and with a pending proposal, Enter=ask / Ctrl+Enter=answer, chip swap leaks no text, tab order, reduced motion, no `🎤`/`✓` in DOM.
- [ ] Screenshot rest / thread / proposal at 1280 and 900 into `web/briefs/impl-*.png`.
- [ ] Commit: `chore(web): unified question chat — visual gate evidence`.

## Out of scope / deferred

- Zen chrome 32px strip (spec in `design-system/MASTER.md`), min-h-44px top-bar tab targets.
- Research-turn budget 6 → 8–10 (only if backfill retries keep failing).
- LLM citation-verification forgery and doc-poison cascade (separate design pass).

## Order

Tasks 1–4 are core (serial, one writer). Tasks 5–6 are web (serial after 4). Task 7 last, supervisor-run. One critic gate per commit.
