# Question Preflight Package — Implementation Plan

**Date:** 2026-11-01 · **Research:** run `72b4c767` impact brief · **Base:** `257532e`
**Goal:** Stop specialists re-asking the same questions across documents; make questions research-backed, capped, ranked, and topic-grouped; give specialists a plan→research→draft pipeline.

## Problem (verified from live project data)

- 23 open questions: REQUIREMENTS 25 raised, BOM 15, RTM 6 — **5 of RTM's 6 are near-verbatim restatements of REQUIREMENTS questions**.
- Dedupe key is `type::docPath::slug` — cross-doc twins structurally never dedupe (`question-portal.ts:29-34`).
- No upstream-question injection: the no-re-ask rule only fires on answers in the *current* prompt (`open-questions.ts:13`).
- Unanswerable "questions" (vendor price/lead time, bolt-circle verification, DC-link capacitance) are asked to the user instead of researched.
- No cap, no ranking, no topic structure — 20 flat questions per doc.

## Design (user-approved)

Pipeline per document-specialist turn:

```
discovery → SPECIALIST SCOPING TURN (cheap, no drafting, no web; emits anticipated
structure + info needs + pre-ranked questions + ICD-system topic tags)
→ RESEARCH PREFLIGHT (read-only: fs_read/fs_list/state_read/web_search + fuzzy portal
search; produces dossier: settled decisions | already-open questions | researched
candidate answers with sources | unresolved→user-decision flags)
→ DRAFTING TURN (dossier + scoping plan injected; unresolved info-needs become the
capped/ranked/topic-tagged Open Questions section)
→ CRITIC (new checks: claims cited; no contradiction with recorded answers;
dossier adopted-or-overturned with justification)
```

Plus independent portal improvements: fuzzy cross-doc dedupe (`meta.upstreamOf`), question cap 9/doc, topic grouping in the web panel.

## Touch / Impact (from researcher brief — anchors verified @ 257532e)

| File | Change |
|---|---|
| `src/core/runner.ts` | P1 inject at prompt assembly `:391`; P3/P6 stage slots after discovery `:296` before drafting `:377`; P4 cap slice at onQuestions hook `:635-663`; stage flags in TurnOptions (`:86-91` criticDisabled precedent); **stages run with fresh `priorMessages: []`** so they never enter sessionMessages/compaction |
| `src/core/open-questions-parser.ts` | P1 `buildUpstreamQuestionContext(projectPath, excludeSpecialistId)` pure helper; P4 cap helper; P5 topic extraction; reuse `questionSlug` `:32-46` (10-word cap normalizes similarity) |
| `src/core/question-portal.ts` | P2 fuzzy cross-doc dedupe in `addPortalItem:84-90` (token-Jaccard over slug, threshold; topic-tag mismatch vetoes merge); answer-supersede `:153-159` cascades to `upstreamOf` children; `listPortalItems:185` topic filter + hide `upstreamOf` children (they still count toward P4 cap accounting) |
| `src/core/critic.ts` | P3/P6 preflight checks section (pattern: `criticFocusSection:104-109`, `stageHintSection:156-158`) |
| `src/specialists/open-questions.ts` | P1 no-re-ask wording (reuse literal `PREVIOUSLY ANSWERED` trigger phrase); P4 cap-9 + ranking directive; P5 topic-tag directive (fixed enum: electrical/mechanical/controls-data/thermal — mirrors ICD E/M/D/T in `packages/icd/index.ts`) |
| `src/specialists/registry.ts` | appender loop `:83-91` untouched (rules text carries the additions); exclusions stay general/conops |
| `src/core/research-preflight.ts` (NEW) | P3+P6: scoping-turn runner (allowedTools `['fs_read','fs_list','state_read']`, maxTurns ~4) + preflight runner (allowedTools `['fs_read','fs_list','state_read','web_search']`) via generic `runAgentToolLoop` (`agent-loop.ts:12-105` — allow-list enforced at `:47`+`:105`); **scoping turn runs with the specialist's OWN system prompt** (full mission/formatting context) and unrestricted read access to all project documents — it plans with full knowledge of the deliverable and the baseline; tolerant output parser (JSON-brace-extract precedent `critic.ts:214-216`); degrade path: empty/failed scoping → preflight skims docs itself |
| `src/workspace/types.ts` + `web/src/types/api.ts` | `PortalItemMeta` += `upstreamOf?: string`, `topic?: string` (both mirrors in sync — comment-mandated) |
| `src/server/routes/portal.ts` | GET filter param `topic` `:11-16` |
| `web/src/components/QuestionPanel.tsx` + `views/DevelopmentView.tsx` | topic grouping (group fn over `visiblePool` memo `DevelopmentView.tsx:447-451`; panel renders grouped sections; null-safe for pre-tag items; unknown tags tolerated → "Other") |

**Deliberate policy change:** web_search reaches every doc specialist *indirectly* via the preflight stage (today scoped to architecture/icd only, `tests/specialist-research.test.ts:10-28`). Gated by a `TurnOptions.preflight` flag; retry path (`autopilot.ts:338-341` "skip discovery/web_search") skips both stages.

**Ephemeral contract:** scoping output + dossier are turn-scoped prompt context (like `existingBaselineText`), NOT persisted — state.json schema untouched.

## Tasks (worker order; researcher's integration order)

- **T1 — P4 cap + rules text** (smallest blast radius): rules text (cap 9, rank by blocking impact, provisional-value preference), cap enforcement slice at the onQuestions hook, cap constant exported for P1/P3. Tests: `open-questions-flow.test.ts` >9 fixture.
- **T2 — P5 topic tags**: shared enum const, tagging directive in rules, hook payload `meta.topic`, portal filter, type mirrors, web grouping. Tests: parser extraction, portal filter, QuestionPanel grouping (incl. null-topic + unknown-tag).
- **T3 — P1 upstream injection**: `buildUpstreamQuestionContext` + injection at `runner.ts:391` using literal `PREVIOUSLY ANSWERED` phrasing; truncated/slug-only text to bound prompt size (hard cap on injected chars); cap-consistent with T1. Tests: prompt contains upstream items; no-re-ask rule text intact.
- **T4 — P2 fuzzy cross-doc dedupe**: threshold Jaccard + topic veto + `upstreamOf` tagging + supersede cascade + hidden-but-counted. Re-scope pinned tests (`question-portal.test.ts:93/:453/:500`) to exact-vs-fuzzy semantics. Tests: same-doc exact stays; cross-doc twin above threshold tagged not archived; below threshold separate; answering canonical resolves children; different-topic never merges.
- **T5 — P3+P6 preflight + scoping**: new `src/core/research-preflight.ts` (scoping turn, preflight turn, tolerant parser, degrade path, skip flags); runner integration (both paths via executeTurn; fresh priorMessages; retry-path skip); critic checks section. Tests: new `tests/scoping-turn.test.ts` + `tests/research-preflight.test.ts` (no-write allow-list gate; dossier contains settled+researched w/ sources; contract tests per researcher §P6; skip-flag honored; retry path skips).
- **T6 — Gates + final review**: full suite, build, tsc; critic overall; push.

Per task: worker → supervisor gates → per-task critic → fix loop → next.

## Test strategy

- Root vitest: parser/portal/runner/critic contract tests + new scoping/preflight suites (fake clients; pin no-write allow-lists).
- Web vitest: QuestionPanel grouping (group headers, null-topic bucket, unknown tag → Other), portalDetail untouched.
- `tsc --noEmit` after each task.
- Protected docs: `C:/Users/makel/OneDrive/Desktop/starn test/docs/REQUIREMENTS.md` + `docs/BOM.md` hash-invariant (`b91c15e1` / `486821aa`) across every commit.

## Risk register (mitigations baked into tasks)

- **Prompt-size growth** (system prompt never compacted): hard char caps on injected upstream list + dossier; slug-only truncation.
- **Dedupe false positives**: threshold + topic veto + hidden-items-still-counted.
- **Chain latency** (+2 LLM calls/doc on chain): scoping maxTurns ~4; cheap role-client assignment; skip flags; retry-path skip.
- **Small-model scoping quality**: degrade path = preflight skims docs itself.
- **Twin resurrection**: supersede cascades to `upstreamOf` children on answer.

## Out of scope (this package)

Decision clusters (answer-one-root-propagates) — future work, foundation exists via answerHistory. Portal read tool for scoping (use `state_read`).
