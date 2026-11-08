# Researcher Delegation — Implementation Plan

Spec: `docs/superpowers/specs/2026-11-08-researcher-delegation-design.md` (rev 2)
Impact analysis: every line reference below came from a read-only code audit.

## Touch / Impact

| File | Change | Depends on |
|---|---|---|
| `src/core/research-delegation.ts` | NEW. Thin wrapper: `runResearchDelegation(deps, req)` → `{ok,answer,sources,confidence,band,reasoning,options?}`. Reuses `runQuestionResearch`, `assessResearch`, `runGateWithTimeout`. Maps timeout/AbortError/no-answer to reason strings | research-gate.ts |
| `src/tools/types.ts` | + `requestResearch?: (req: {question: string; focus?: string[]}) => Promise<ToolExecutionResponse>` on `ToolExecutionContext` (:5–19). No clients, no models | — |
| `src/tools/handlers/request-research.ts` | NEW. `request_research` definition + arg validation + markdown formatter (8000-char cap) | research-delegation |
| `src/tools/registry.ts` | register handler in the constructor (:25–34) | handler |
| `src/core/agent-loop.ts` | + `researchCallCount`, sibling of `toolCallCount` (:73); cap check before dispatch (:122); 4th call returns the limit string without executing | — |
| `src/core/runner.ts` | build `requestResearch` closure (:423–436) and pass into the tool context (:498); post-turn plan check (:477–505) | research-delegation, event |
| `src/server/session.ts` | build `requestResearch` for advisory (:917) and conclude (:1006) turns; `THREAD_ALLOWED_TOOLS` (:51) += `request_research`; thread row writer (:854) | research-delegation |
| `src/specialists/registry.ts` | + `applyInformationPlanRule()` beside :52–99, appended for all 15 packages; information-only variant for conops/general/change-impact | — |
| `src/specialists/packages/*/index.ts` | `allowedTools` += `request_research` (15 files, one line each) | — |
| `src/core/autopilot.ts` | `AutopilotEvent` union (:16–30) += `plan` variant with `specialist, docId?, itemId?, order, claims[]` | — |
| `src/core/question-portal.ts` | `isPermanentThreadRow` unchanged; `appendThreadMessage` accepts the research row | workspace/types |
| `src/workspace/types.ts` | `PortalThreadMessage.kind` (:118) += `'research'`; `research` payload field | — |
| `src/server/session.ts` | `threadTranscript` (:866–878) renders research rows | types |
| `web/src/types/api.ts` | mirror `kind: 'research'` + `research` payload (:250) | — |
| `web/src/hooks/useAutopilotEvents.ts` | union mirror (:17–30) + explicit `plan` branch that does NOT merge into status (:106–111) | — |
| `web/src/views/DevelopmentView.tsx` | `plan` case in the event switch (:471–531; `default: return` at :529) | — |
| `web/src/components/question-chat/ChatLog.tsx` | research row branch beside :230 | — |
| `tests/research-delegation.test.ts` | NEW | — |
| `tests/request-research-tool.test.ts` | NEW | — |
| `tests/thread-endpoint.test.ts` | update the two `toEqual(['fs_read','fs_list','state_read'])` assertions (:114, :323) | — |
| `tests/specialists.test.ts` | assert the information-plan rule is appended to all 15 | — |

Not touched: critic, autopilot chain driver, portal research gate behaviour,
`docs/REQUIREMENTS.md`, `docs/BOM.md`, user `state.json`.

## Tasks

### T1 — Core delegation runner

`src/core/research-delegation.ts`. Input deps are exactly what
`session.buildResearchGateDeps()` (session.ts:754–779) already assembles:
drafting client, critic client, tool registry, logger, search client,
transcriber, verifySource.

- `runResearchDelegation(deps, req)` calls `runQuestionResearch` for a synthetic
  question, then `assessResearch`, and maps to the return shape.
- Band: ≥0.85 high, ≥0.3 medium, else low.
- Catch: `AbortError` → `{ok:false, reason:'timeout'}`; empty answer →
  `{ok:false, reason:'unverified'}`; any other throw → `{ok:false, reason:'error'}`.
- Pure mapping function `toBand(confidence)` exported for tests.
- No imports from `tools/`, `server/`, or `cli/`.

Acceptance: unit tests for the three bands, timeout mapping, empty-answer
mapping; `tests/core-decoupling.test.ts` passes.

### T2 — Tool + capability + cap

- `request_research` handler: validates `question` (non-empty, ≤1000 chars) and
  `focus` (≤5 paths, each resolved under the project root); formats markdown per
  spec §4; 8000-char cap.
- `ToolExecutionContext.requestResearch` optional function; handler returns the
  "Research unavailable in this context" string when absent.
- Agent loop: `researchCallCount` reset per loop invocation; 4th call returns
  `Research call limit reached (3 per turn). Answer with what you have and name the remaining gaps.`
  as `success: true` without dispatch.
- Registry: register the handler.

Acceptance: handler unit tests (validation, markdown shape, missing capability);
loop test proving the 4th call does not invoke the function; existing
`tests/agent-loop-budget.test.ts` unchanged.

### T3 — Wire the capability

- `runner.ts:423–436`: build the closure from the same clients used for the
  research stage; pass into the tool context at `:498`.
- `session.ts:917` (advisory) and `:1006` (conclude): build the same closure.
- `THREAD_ALLOWED_TOOLS` (:51) += `request_research`; update
  `tests/thread-endpoint.test.ts:114,323`.

Acceptance: an advisory turn with a stubbed research function receives findings;
`THREAD_MAX_TURNS` behaviour unchanged.

### T4 — Information plan rule + event

- `applyInformationPlanRule()` in `src/specialists/registry.ts`: appends the
  "Information needed" paragraph when the prompt contains
  `DISCOVERY, PLANNING & EXECUTION WORKFLOW`; information-only variant for
  `conops`, `general`, `change-impact`.
- `AutopilotEvent` `plan` variant + parse from the specialist's plan prose using
  the existing `ScopingPlan.infoNeeds` shape.
- `runner.ts:477–505` post-turn check: research without a plan event logs
  `Plan missing: research was requested without an information plan.`

Acceptance: all 15 packages expose the rule; a turn with research and no plan
warns; a turn with a plan emits one event with `docId`.

### T5 — Thread row + web

- `kind: 'research'` in types (core + web mirror), thread row written by the
  session when an item id is in context, `threadTranscript` renders it,
  `ChatLog.tsx` branch.
- `useAutopilotEvents` `plan` branch that does not merge into `autopilotStatus`.
- `DevelopmentView` `plan` case: one line per unknown.

Acceptance: web tests for the research row and the plan line; no `claims[]`
leak into `autopilotStatus` (assert on the hook output).

### T6 — Gates and live E2E

- Full root suite, web suite, `tsc` root + web, build.
- Live: restart server, ask the open-question chat "look into the performance
  chart for me1115", confirm a research row with confidence, a reply citing
  curve values, and the plan event in the stream.
- Critic review; then push.

## Risks

| Risk | Mitigation |
|---|---|
| Research inside a drafting turn blows the turn wall-clock | One 240 s call per delegation; cap 3; the loop's own timeout is unchanged — measure in T6 |
| Plan parsing is brittle (free-text model output) | Reuse `parseScopingPlan`; a parse miss emits no event and only the warning |
| Allow-list growth breaks `toEqual` assertions | T3 updates both assertions in the same commit |
| `plan` event pollutes autopilot status | Explicit non-merging branch, asserted in T5 |
