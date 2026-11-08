# Question Experience Upgrade — Plan

**Date:** 2026-11-02 · **Base:** `2240070`

## Scope (user-approved)

Three coordinated upgrades to the question experience:

### T-A — Question format v2 (decision-memo format)
Shared rules text (`OPEN_QUESTIONS_SECTION_RULES`) mandates per question:
`**Qn. [TOPIC] Short concise question.**` then labeled sections:
**BLUF:** (recommendation up front) · **Research findings:** (what's known + sources, incl. dossier/preflight findings) · **Main suggestion:** (option + trade-off) · **Alternatives:** (each with trade-off) · **Defer:** (what deferring costs). Parser (`extractQuestionItems`/section6-resolver consumers) stays tolerant — missing sections parse as today; titles remain the parse key. Web rendering (QuestionPanel detail + portalDetail) renders the labeled sections; BLUF becomes the headline of the answer card.

### T-B — Legacy backfill ("Research open questions")
- Endpoint `POST /api/portal/research-all` + panel button (violet, aria-labeled): iterates open `question` items lacking `researching/proposedAnswer/autoApplied`, marks `researching`, runs the existing `runResearchGate` per item sequentially (bounded, sequential not parallel).
- Gate enrichment now ALSO rewrites the item's stored title into format v2 from research + critic rationale (BLUF/suggestion/alternatives assembled from research + assessment) — legacy items get reset into the new experience with real evidence, not fabricated.
- Result per item: auto-applied (≥0.95) / pre-answered proposal (YES/NO/EDIT) / plain (research exhausted) — as shipped in the gate.
- User-response field: item history already records user answers; confirm/override paths unchanged.

### T-C — Answer-thread chat (advisory specialist conversation)
- Per-item thread stored on portal item (`meta.thread: [{role: 'user'|'specialist'|'researcher', text, ts}]`, both type mirrors).
- Endpoint `POST /api/portal/:id/thread` (user message) → quick read-only turn (specialist system prompt + research dossier + thread history + project docs via fs_read/state_read; NO write tools, NO critic, no doc edits, maxTurns ~4, fresh priorMessages) → reply appended to thread; SSE event updates panel.
- UI: chat area inside the question detail (portal popover/panel) with input; transcript persisted; "advise only — answers go through YES/NO/EDIT or free-text response" notice; aria labels match copy; no color-only; reduced-motion respected.
- Guard: thread replies never modify docs; if the reply recommends a decision, user acts via the existing answer paths.

## Touch / Impact

| File | Change |
|---|---|
| `src/specialists/open-questions.ts` | format-v2 rules text |
| `src/core/open-questions-parser.ts` | tolerant section extraction (BLUF/suggestion fields on parsed items, optional) |
| `src/core/research-gate.ts` | enrichment: build format-v2 title/sections from research+assessment during backfill |
| `src/server/routes/portal.ts` | `POST /research-all` (+ busy guard), `POST /:id/thread` |
| `src/server/session.ts` | thread turn executor (read-only specialist Q&A, wired role clients) |
| `src/workspace/types.ts` + `web/src/types/api.ts` | meta: `thread?: ThreadMessage[]`, parsed item fields |
| `web/src/components/QuestionPanel.tsx` + `web/src/lib/portalDetail.ts` | format-v2 rendering, chat area, Research-all button |
| `web/src/api/client.ts` | researchAll(), postThreadMessage() |
| Tests | format parsing (v2 + legacy tolerant), research-all loop + guards, thread endpoint (no-write allow-list, persistence), web render/interaction |

## Order
T-A + T-B one worker (they share the gate/parser surface), T-C second worker (UI-heavy, cleaner seam after T-B). Per-task critic gates; final overall + push.
