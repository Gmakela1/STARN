# Portal Research Gate — Implementation Plan

**Date:** 2026-11-01 · **Base:** `8a46fe6` · Builds on question-preflight package (T1–T5 + security hardening)

## Problem

Questions that survive the drafting-time research preflight go **straight to the user**. No second-chance research pass. User burden stays higher than necessary; vendor-verifiable items (price, datasheet values) land as open-ended questions.

## Design (user-approved)

**Two-tier gate, post-intake (async, non-blocking):**

```
Question survives drafting → portal intake (dedupe, cap as today)
        ▼ item appears immediately with meta.researching=true
RESEARCH TURN (read-only: web_search, fs_read incl. reference docs, state_read)
        │  structured output: { answer, sources[], reasoning }
        ▼
RESEARCH CRITIC (dedicated rubric — judge, not the researcher's self-report):
  source authority (vendor spec/datasheet=top tier, forum/SEO=low),
  evidence directness (stated vs inferred), consistency with recorded
  answers + approved baseline (conflict = fail), assumption count
        │  emits confidence 0..1 (critic-assessed)
        ├─ confidence ≥ 0.95
        │     → AUTO-APPLY: answer flows into the doc pending block
        │       (answerHistory records research provenance), item resolved,
        │       STATUS EVENT notification; UNDO available until incorporation:
        │       re-opens item + removes exactly the appended text (stored in meta)
        ├─ confidence < 0.95 with a usable candidate
        │     → meta.proposedAnswer {answer, sources, confidence}
        │       panel shows pre-answered item: YES / NO / EDIT (edit = free text)
        │       confirm → normal answer-applier path (instant edit, critic-once
        │       when the doc's last question resolves)
        └─ exhausted / no candidate
              → plain open question (today's behavior)
```

- **Post-intake enrichment**, not in the drafting turn path: the specialist's turn completes without waiting on N research turns; panel items visibly flip `researching → answered/proposed` via existing SSE status events.
- **Confidence is critic-assessed** (dedicated rubric mirroring the document-critic pattern: source authority tiering — a single vendor spec sheet that directly states the answer can reach auto-apply; consistency conflicts with recorded answers fail outright; researcher does NOT self-grade).
- **Undo window:** before incorporation, undo removes the appended text exactly (stored snapshot in meta). After incorporation, undo re-opens the item + doc flips to revised (existing flows handle).
- **Cost bound:** ≤9 questions/doc/turn (existing cap) × maxTurns-bounded research turn each; runs only for NEW open questions.

## Touch / Impact

| File | Change |
|---|---|
| NEW `src/core/research-gate.ts` | runQuestionResearch(deps, item): read-only runAgentToolLoop (allowedTools `[fs_read, fs_list, state_read, web_search]`, maxTurns ~6, fresh priorMessages), tolerant structured parser; auto-apply executor (append answer text to pending block via answer-applier's edit path, provenance in answerHistory meta.research); undo executor (remove stored appended text / re-open) |
| `src/core/critic.ts` (or research-gate module) | research-assessment critic: dedicated rubric prompt, same evaluate-client pattern as document critic; returns {confidence, verdict, rationale} |
| `src/core/question-portal.ts` | PortalItemMeta += `researching?: boolean`, `proposedAnswer?: {answer, sources, confidence}`, `autoApplied?: {answer, appendedText}` (both type mirrors); enrichment hook for gate |
| `src/core/runner.ts` | after onQuestions intake: kick gate for new items (non-blocking; failure = item stays plain) |
| `src/core/answer-applier.ts` | accept research-provenance answers (answerHistory meta carries `source: 'research-gate'`) — no behavior change to trigger logic |
| `web/src/components/QuestionPanel.tsx` + types mirror | `researching` spinner state on item; proposed-answer card (source list, confidence) with YES/NO/EDIT controls; auto-applied state with UNDO button (within window); aria labels match visible copy; no color-only |
| `src/server/routes/portal.ts` (+ SSE) | endpoints: confirm/override proposed answer; undo auto-applied item; `researching` field in payload |
| Tests | `tests/research-gate.test.ts` (parser, critic-assessed confidence tiering, source-authority rubric, auto-apply append + undo removal, exhaustion → plain); portal + web tests for proposed/undo states |

## Out of scope (this package)

Cross-question batch research (per-question turn only); reference-PDF deep extraction beyond existing doc_transcribe/fs_read; auto-apply of judgment-call questions (always <0.95 route).
