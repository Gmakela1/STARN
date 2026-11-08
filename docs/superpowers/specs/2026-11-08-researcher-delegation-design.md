# Researcher Delegation — Design Spec (rev 2)

Date: 2026-11-08
Status: approved for implementation
Revision: rev 2 — corrected against a code impact analysis. Rev 1 assumed
capabilities the code does not have (see §12).

Related: `2026-11-08-pdf-chart-reading-design.md`, research gate
`src/core/research-gate.ts`, scoping plan `src/core/research-preflight.ts`.

## 1. Problem

A specialist cannot retrieve information. When a drafting specialist or the
open-question chat needs a fact that lives in a reference document or on the
web, it either guesses from stale context or reports the source as unreadable.

Observed live, open-question chat on the ME1115 chart:

> "I can't extract the curve values from reference/ME1115-performance sheet.pdf
> — it's an image-only chart, and my live web-search verification was
> unavailable this session (API 401)."

The PDF is a vector chart, and the research gate can already read it. The
specialist had no way to ask.

## 2. Goal

A specialist hands a targeted information request to the researcher, receives
findings with sources and a confidence band, and reasons over them — the way an
engineer asks a colleague to check something.

## 3. Non-goals

- Specialists gaining direct access to `web_search`, `web_fetch`,
  `read_chart_data`, or any retrieval tool. They stay planning/writing only.
- Multi-agent conversation. One request, one bounded research run, one answer.
- Changing the autopilot chain, the portal research gate, or the critic.

## 4. Tool shape

```ts
request_research({ question: string, focus?: string[] })
```

`focus` is project-relative paths to check first. There is **no `want` field**:
the researcher decides which of its own tools to use, and a caller-side hint
would only invite it to skip a check it should have made.

The researcher's allow-list is `['fs_read','fs_list','state_read','web_search',
'web_fetch','read_chart_data']`. `web_fetch` was missing until now — the
researcher could search but not open a result, while specialists could fetch
directly. That inversion is why specialists did their own retrieval. See §12.9.

Response: `ToolExecutionResponse` with `success: true` and markdown in `result`.

```md
## Research findings
<answer paragraph>

### Evidence
- <source title> — <url or project path>

### Confidence
medium (0.62) — <why, in one line>

### Decision options
A) … B) … C) … Recommended: B      (only when the answer carries them)
```

Whole result capped at 8000 characters.

## 5. Behaviour

1. Runs the **same** pipeline as the portal gate. Reuse
   `runQuestionResearch` (research-gate.ts:285), `assessResearch` (:364) and
   `runGateWithTimeout` (:498). No forked prompt, no second critic.
2. Budget: the gate's own 10 turns / 240 s, unchanged. These are the research
   loop's internal turns; the specialist sees **one** outer tool call.
3. Cap: **three `request_research` calls per outer loop invocation.** A fourth
   returns `success: true` with
   `Research call limit reached (3 per turn). Answer with what you have and name the remaining gaps.`
   The counter is a sibling of `toolCallCount` in `src/core/agent-loop.ts:73`,
   checked immediately before dispatch at `:122`.
4. `request_research` is never in `PREFLIGHT_ALLOWED_TOOLS`,
   `RESEARCH_GATE_ALLOWED_TOOLS`, or the critic's list — no recursion.
5. Failures return `success: true` with a reason, never an exception:
   - no capability wired → `Research unavailable in this context. Report the gap; do not invent values.`
   - timeout / `AbortError` → `Research timed out after 240 s. Report the gap.`
     (the gate re-throws `AbortError` at research-gate.ts:334 and abandons at
     :509 — the handler must catch both)
   - no answer → `No verifiable source found. Report the gap.`
6. The specialist must not present research as its own finding: the tool result
   carries sources, and the specialist's reply must cite them.

## 6. Confidence bands

Passed through from the critic assessment, unchanged. Three bands, never a bare
number the model can round up:

| Band | Range | Specialist behaviour |
|---|---|---|
| `high` | ≥ 0.85 | May state as fact, cite source |
| `medium` | 0.3 – 0.85 | State with the qualifier |
| `low` | < 0.3 | Must say it could not be verified |

## 7. Extend the existing running plan — do not add a second one

Every specialist prompt already carries `DISCOVERY, PLANNING & EXECUTION
WORKFLOW (MANDATORY)` with an **Explicit Running Plan** step (12 of 15
packages; `conops`, `general`, `change-impact` have none). That step answers
*what the document contains, in what order*. It does not answer *what the
document needs to know that it does not yet know*.

So the plan gains an information section:

```
PLAN
1. <what the document will contain, in what order>        (existing step)
2. Information needed:
   - <claim> — KNOWN: <doc> §<section>
   - <claim> — UNKNOWN: <question> → likely in <path | vendor page | standard>
```

Rules:

1. Delivered as a **load-time registry rule**, `applyInformationPlanRule()`,
   beside `applyOpenQuestionsRules` / `applyReferenceInspectionRules` /
   `applyDocumentOutputRules` (registry.ts:43–45, :52–99). One rule reaches all
   15 packages; no per-package duplication. It appends, it never rewrites the
   existing step — `tests/specialists.test.ts:201–208`,
   `tests/build-sequence.test.ts:40` and `tests/risk-register.test.ts:32`
   assert on the existing text with `toContain`.
2. `conops`, `general`, `change-impact` receive the "Information needed"
   paragraph only, without a drafting order.
3. Each `UNKNOWN` line maps to at most one `request_research` call, in written
   order, up to three.
4. The plan is emitted as a structured event **in addition to** the prose:

```ts
{ kind: 'plan', specialist: string, docId?: string, itemId?: string,
  order: string[],
  claims: [{ claim, status: 'known' | 'unknown', source?, question?, likelyAt? }] }
```

`docId` / `itemId` are required — without them the web layer cannot attribute a
plan to a question (the answer-frame precedent at autopilot.ts:26–30 carries
`itemId`).
5. Surfaced in the activity stream as one line per unknown
   ("Researching: motor continuous rating — expected in reference/ME1115 Rev A.pdf").

## 8. Where the plan is enforced

The tool handler cannot see the plan, so §7.3 is **not** enforceable at the
tool layer. Enforcement is a post-turn check in the drafting loop
(runner.ts:477–505): if a turn called `request_research` and emitted no `plan`
event, log a warning and surface a status line
`Plan missing: research was requested without an information plan.`
It is a visible contract violation, not a hard failure — blocking a completed
document over a missing plan line would be worse than the omission.

## 9. Visibility

Delegation appends a thread row when an item id is in context:

```ts
{ role: 'specialist', kind: 'research', text: '<the question asked>',
  research: { confidence: number, band: 'high'|'medium'|'low',
              sources: { title, url? }[] } }
```

- `PortalThreadMessage.kind` (workspace/types.ts:118) gains `'research'`;
  web mirror `web/src/types/api.ts:250`.
- Not permanent: `isPermanentThreadRow` (question-portal.ts:40–42) keeps only
  `recorded`/`proposal`, so research rows trim under `THREAD_MESSAGE_CAP`.
- `threadTranscript` (session.ts:866–878) currently special-cases only
  `proposal`; a research row must not render as `Specialist: <question>`.
- `ChatLog.tsx` already switches on `kind` (:218 proposal, :230 recorded); add
  the research branch beside :230.

## 10. Allow-lists

| Caller | `request_research` | Where |
|---|---|---|
| Drafting specialists (all 15 packages) | yes | each `allowedTools` |
| Open-question advisory + conclude | yes | `THREAD_ALLOWED_TOOLS` (session.ts:51) |
| Research gate / preflight | **no** | assertion test |
| Critic | no | — |

`THREAD_MAX_TURNS = 3` (session.ts:49) stays: one plan turn, one research
turn, one answer turn. The research loop's own turns happen inside the single
tool call, so they do not consume the outer budget — but the thread loop's
wall-clock must allow one 240 s call.

## 11. Code ownership (compartmentalization)

Boundary that must hold: **`src/tools/` stays provider- and role-client-free.**
A handler declares what it needs and returns a `ToolExecutionResponse`; it never
constructs clients, picks models, or knows about `roleClients`. This also avoids
a real import cycle (`tools/registry` → handler → `core/research-gate` →
`core/agent-loop` → `tools/registry`).

| Piece | Owner |
|---|---|
| Delegation runner (budget, timeout, refusal strings, band mapping) | `src/core/research-delegation.ts` (new) |
| Tool handler (name, definition, arg validation) | `src/tools/handlers/request-research.ts` (new) |
| Capability injection (clients → closure) | `runner.ts:423–436`, `session.ts:754–779` |
| Capability field | `ToolExecutionContext.requestResearch?` (tools/types.ts:5–19) — **one function, no clients** |
| Per-turn cap | `src/core/agent-loop.ts:73`, checked at `:122` |
| Plan rule text | `SpecialistRegistry.applyInformationPlanRule()` (registry.ts) |
| Plan event type | `AutopilotEvent` union (autopilot.ts:16–30) + web mirror |
| Plan parsing | reuse `ScopingPlan.infoNeeds` (research-preflight.ts:137–146) |
| Thread row | workspace/types.ts:118, question-portal.ts:40, session.ts:866, ChatLog.tsx:230 |

## 12. Rev-1 corrections (what the code contradicted)

1. `want: 'web'` removed — the gate has no `web_fetch`.
2. Cap refusal returns `success: true`, not an error (the not-permitted error
   path at registry.ts:62–68 has the wrong flavour).
3. `AbortError` re-thrown by the gate must be caught and mapped.
4. Plan-vs-research linkage moved from the tool layer to a runner post-check.
5. Plan event gained `docId` / `itemId`.
6. `useAutopilotEvents` merges every non-answer frame into `autopilotStatus`
   (`setStatus(prev => ({...prev, ...st}))`, :106–111) — a `plan` event would
   pollute it with `claims[]`; the hook needs an explicit `plan` branch that
   does not merge.
7. Plan type is not new — `ScopingPlan.infoNeeds` already exists.
8. `tests/thread-endpoint.test.ts:114` and `:323` assert
   `toEqual(['fs_read','fs_list','state_read'])` and **will fail** when
   `THREAD_ALLOWED_TOOLS` grows; they must be updated in the same commit.
9. `PREFLIGHT_ALLOWED_TOOLS` (research-preflight.ts:40) omitted `web_fetch`,
   so the researcher could search but never open a page; only `verifySource`
   (session.ts:771) fetched, once, after the answer. The role the user asked
   for — researcher retrieves, specialist writes — requires `web_fetch` in the
   research allow-list. Updated allow-list tests: `tests/research-gate.test.ts`
   (the `getDefinitions` whitelist) and `tests/scoping-turn.test.ts`.

## 13. Acceptance criteria

1. Open-question chat, "look into the performance chart for me1115" →
   `request_research` → `read_chart_data` with declared axes → the reply cites
   sampled values with the source and a confidence band.
2. A web question with a working provider returns sourced findings and the
   reply cites the URL.
3. No provider → the specialist says it could not verify; no fabrication.
4. The researcher cannot call itself (allow-list assertion).
5. Fourth call in one loop returns the limit string and runs no research.
6. A drafting turn that calls research without a plan logs the visible warning.
7. Existing suites green; `tsc` clean root and web.
