# Researcher Delegation — Design Spec

Date: 2026-11-08
Status: awaiting approval
Related: `2026-11-08-pdf-chart-reading-design.md`, research gate in `src/core/research-gate.ts`

## 1. Problem

A specialist cannot retrieve information. When a drafting specialist or the
open-question chat needs a fact that lives in a reference document or on the
web, it either guesses from stale context or reports the source as unreadable.

Observed live: the ME1115 chart question produced

> "I can't extract the curve values from reference/ME1115-performance sheet.pdf
> — it's an image-only chart, and my live web-search verification was
> unavailable this session (API 401)."

The PDF is a vector chart and the research gate can read it. The specialist
never had a way to ask.

## 2. Goal

A specialist can hand a targeted information request to the researcher, get
back findings with sources and a confidence level, and then reason over them —
the same way a human engineer asks a colleague to go and check something.

## 3. Non-goals

- Specialists gaining direct access to `web_search`, `read_chart_data`, or any
  retrieval tool. They stay planning/writing only.
- A general multi-agent conversation. One request, one bounded research run,
  one response.
- Changing how the autopilot chain or the portal research gate work.

## 4. Shape

New tool, available to specialists: `request_research`.

```ts
{
  question: string;        // what to find out, in one or two sentences
  focus?: string[];        // project-relative paths worth checking first
  want?: 'answer' | 'chart' | 'web';   // default 'answer' — a hint, not a filter
}
```

Response (a `ToolExecutionResponse` whose `result` is markdown):

```md
## Research findings
<the answer paragraph>

### Evidence
- <source title> — <url or project path> (confidence: high|medium|low)

### Confidence
0.82 — verified against the manufacturer's own manual; curve values read from
a vector plot (±1% of axis span).

### Decision options
A) … B) … C) … Recommended: B
```

## 5. Behaviour

1. The tool runs the **same** research pipeline as the portal gate: scoping →
   preflight → one bounded research loop → critic assessment. No second
   implementation.
2. Budget: `maxTurns 10`, hard timeout 240 s, same as the gate.
3. The specialist's outer loop may call `request_research` **at most twice per
   turn**; a third call returns a refusal string telling it to answer with what
   it has.
4. `request_research` is never in the researcher's own allow-list — no
   recursion.
5. Failure modes return a normal tool result, never an exception:
   - no search provider configured → `Research unavailable: no search provider
     is configured. Report the gap; do not invent values.`
   - timeout → `Research timed out after 240 s. Report the gap.`
   - unverifiable → `No verifiable source found. Report the gap.`
6. The specialist must not present research output as its own finding: the tool
   result carries its sources, and the specialist's reply must cite them.

## 6. Confidence

The critic's confidence score is passed through unchanged. The specialist sees
three bands, not a number it can round up:

| Band | Meaning | Specialist behaviour |
|---|---|---|
| `high` (≥ 0.85) | Verified against a primary source | May state as fact, cite source |
| `medium` (0.3–0.85) | Plausible, single or secondary source | State with the qualifier |
| `low` (< 0.3) | Not verified | Must say it could not be verified |

## 7. Visibility

Every delegation appends a thread row to the question when the call happens
inside an open-question conversation:

```ts
{ role: 'specialist', kind: 'research', text: '<the question asked>',
  research: { confidence, sources: [{ title, url }] } }
```

The chat renders it as a distinct row ("Researcher — asked to check …") so the
user sees the retrieval step, its sources, and its confidence rather than a
silent answer. Rows are capped by the existing `THREAD_MESSAGE_CAP`.

## 8. Allow-lists

| Caller | `request_research` |
|---|---|
| Drafting specialists (all packages) | yes |
| Open-question chat (`concludeThread`, advisory) | yes |
| Research gate / preflight | **no** (recursion) |
| Critic | no |

## 9. Failure and degradation

- Search provider missing or 401 → the tool returns the refusal text above; the
  specialist answers with what it has and names the gap.
- Chart request without a declared axis pair → the tool returns the extractor's
  refusal (multi-scale page) and asks the specialist to declare the axes.
- Research that contradicts the program baseline → the finding is returned with
  the conflict noted; the specialist must surface the conflict, not silently
  adopt the new value.

## 10. Acceptance criteria

1. In the open-question chat, "look into the performance chart for me1115"
   triggers `request_research`, which calls `read_chart_data` with declared
   axes, and the specialist's reply cites sampled values with the source.
2. A web question with a working provider returns sourced findings and the
   specialist cites the URL.
3. With no provider configured, the specialist says it could not verify — it
   does not fabricate.
4. The researcher cannot call itself (allow-list assertion in a test).
5. Two calls per turn maximum, enforced and tested.
6. Existing suites unchanged; `tsc` clean root and web.
