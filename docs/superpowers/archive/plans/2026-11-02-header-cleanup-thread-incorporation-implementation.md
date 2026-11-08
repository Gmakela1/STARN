# Question Header Simplification + Thread-Aware Incorporation — Implementation Plan

**Date:** 2026-11-02 · **Research:** run `83e3b67f` impact brief · **Base:** current master (+ presentation-v2 critic fixes landing)

## Part A — Header = number + topic + short question only

**Verified gaps (researcher A1-A8):**
- `shortResearchTitle` (research-gate.ts:137-140) only strips the Qn prefix + 60-char cap — does NOT cut trailing explanation. Keep it for status lines; header shortening happens at parse/intake instead.
- Parser hole: `stripWhyItMatters` (open-questions-parser.ts:93-107) cuts at labels (legacy `Why it matters:` or v2 BLUF/… labels) — but **unlabeled appended prose is never cut** (legacy `**Qn. Title.** context…` with no labels → full prose becomes the title).
- Format-v2 rules never forbid appended prose after the bold title — specialists can legally produce blobs.
- Web card top (QuestionPanel.tsx:832-842) renders `item.title` + topic chip — no question-number element exists (parser regex consumes `Qn`).

**Tasks:**
1. **Rules tightening** (open-questions.ts:39-53): "The bold title line contains ONLY the question number, [TOPIC] tag, and the short question itself — NO background, justification, or explanation prose after the closing bold. All context MUST go in BLUF / Research findings / Main suggestion / Alternatives / Defer lines."
2. **Parser sentence-boundary cut** (stripWhyItMatters): for unlabeled blobs >~120 chars, cut after the first sentence terminator (`?` / `. `) that yields a ≤120-char title; remainder flows into background context (sections.background if labeled sections exist, else item detail). Slug-drift risk (A5): one-shot heal — when cutting, persist `meta.originalTitle` (existing machinery) and key dedupe on `meta.originalTitle ?? title` (already does) → no drift for re-intake.
3. **Question-number chip** (web): store `meta.questionNumber` at intake (derive from `meta.originalTitle`'s `Qn` or the parsed entry); QuestionPanel renders `Q#` chip + topic chip + short title ONLY in the top line; explanation stays in detail/BLUF/memo sections (already below).
4. Tests: parser cut (unlabeled blob → short title + context preserved), intake number chip, header render (number+topic+title only), rules-coverage string test.

## Part B — Thread reaches the specialist at incorporation

**Verified architecture (researcher B1-B6):**
- `buildIncorporationPrompt(phaseId)` (incorporation-prompt.ts:74-83) currently carries NO thread/answerHistory content — answers reach the doc via the pending block only.
- Incorporation runs per-PHASE at TWO call sites: `autopilot.ts:599` (chain path) and `answer-applier.ts:193` (idle/last-answer path). Both need injection.
- NEVER append thread text to the doc pending block (`appendedText` byte-contract for UNDO breaks) — prompt-only injection is correct.
- Thread storage: `meta.thread` capped 20 msgs × 2000 chars, persists after answering (needed — it must be readable at incorporation).

**Tasks:**
1. `buildIncorporationPrompt(phaseId, threadContext?: string)` — appends `## Advisory conversation with the user` block framed as: "Advisory context — the user's reasoning train of thought from chat. Inform the rewrite; do NOT contradict the explicit answers above."
2. Shared collector helper (incorporation-prompt.ts): for the phase's docPath, gather items with non-empty `meta.thread` (open OR answered — thread persists), render last 6-8 messages (user messages full, specialist replies truncated ~400 chars, first user message prioritized), whole block capped `THREAD_CONTEXT_CHAR_CAP = 3000` (whole-line drops precedent).
3. Wire both call sites: autopilot incorporation prompt build + answer-applier idle-path trigger.
4. Tests: prompt contains advisory block when thread exists; absent when none; both call sites; cap enforced; answered-item thread still reaches incorporation; UNDO byte-contract untouched (no thread text in appendedText); stale-thread case — thread inherited via answerHistory (answer-applier.ts:295-301) doesn't re-inject a consumed conversation into a NEW question's incorporation (watermark: tag injected thread messages `meta.threadConsumedBy: <phaseId+ts>` or only inject threads of items answered in THIS pending round).

## Out of scope / deferred
- Collapsible Zen chrome (design done, spec in MASTER.md — separate worker after approval).
- Raising research-turn budget (6 turns) — only if backfill retries keep failing on budget exhaustion.

## Order
One worker, two commits: (1) `feat(core): question header simplification — short-question-only titles + number chip`; (2) `feat(core): thread-aware incorporation — advisory conversation reaches the specialist`.
