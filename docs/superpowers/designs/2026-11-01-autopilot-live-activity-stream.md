# Autopilot Live Activity Stream — Design Spec

**Date:** 2026-11-01 · **Scope:** polish pass on Engineering Studio chat pane (web presentation layer + core status copy) · **Stack:** React 18 + Tailwind (slate/sky/cyan/rose/amber) + lucide-react · **No new dependencies**

---

## 1. Problem statement

Autopilot live events are appended into the chat as `role: 'system'` entries and rendered identically to errors: `border-rose-900/60 bg-rose-950/30`, a `TriangleAlert` in `rose-400`, and a header that reads **SYSTEM**. The user reads a healthy run as a wall of errors. Compounding it, the copy itself is engine-speak ("Classifying request…", "Executing specialist…", "Running harsh critic evaluation…") and every status line is prefixed with a decorative `🔍`.

**Goals (user-stated):**
1. Status updates in natural English — calm, useful, "slightly cool to follow along", zero jargon.
2. Not red, not labeled "System".
3. A well-designed live-stream indicator.

**Hard constraints:**
- Real state visibility must survive: active phase, critic score, attempt count, auto-approved vs parked, outcome.
- Errors may stay warm but must be unambiguously errors (icon + word "Needs attention", never "System").
- No new npm deps. Core copy changes in `runner.ts`/`autopilot.ts` are allowed and wanted (they are the source of displayed text). Presentation changes only in the web layer.

---

## 2. Recommendation: interleave, don't section off

**Recommendation: keep activity interleaved in the chat stream, rendered as a distinct, subordinate "feed line" treatment. Do NOT create a separate activity console/panel.**

Rationale:
- **Continuity.** The user asked to "watch the agent work while following along". Splitting activity into a second panel (or a collapsed drawer) moves the action away from the conversation it belongs to and forces the eye to track two scroll regions.
- **Chronology.** Autopilot episodes *are* phases of the conversation ("draft X → baseline check → approve → next"). Interleaving preserves cause-and-effect order; a side console can't.
- **Density.** Feed lines are ~20px tall with no card chrome. A full 13-phase run adds ~25–35 thin lines to an in-memory chat. That reads as "look how much work just happened", which is the payoff the user wants — collapsing it would hide exactly the outcome trail (score, attempts, approved/parked) that must stay visible.
- **Minimal diff.** The data pipeline already interleaves via `appendEntry`. We change only the *rendering* of `role:'system'` + attach a typed `activity` meta; no layout restructure, no new route/state.

**When to revisit:** if a single run routinely emits >60 tool events, group consecutive tool_lines under a collapsible `<details>` (deferred, not now).

---

## 3. Live-stream visual treatment

### 3.1 The feed line (calm, secondary, non-interactive)

```
[dot] [icon] Drafting System Requirements…                           ← newest, full opacity + pulsing cyan dot
      [icon] Reading docs/ARCHITECTURE.md
      [icon] Comparing the draft against the approved project baseline…
      [icon] Baseline review suggests refinements (score: 7.5/10). Polishing — pass 1 of 2…
      [icon] Approved System Requirements — continuing…
```

Rules:
- **No card, no header, no label.** `role:'system'` activity entries lose the rose card, the `TriangleAlert`, and the word "System" entirely. They become bare flex rows: `flex items-start gap-2`.
- **Timeline dot rail (the live-stream indicator).** Each feed line carries a 6px `rounded-full` dot, absolutely positioned at `left`. Consecutive activity lines form a reading rail; the rail breaks at user/AI bubbles, which correctly reads as "work burst, then conversation".
  - default dot: `bg-slate-600`
  - **active/current dot (the LIVE indicator):** `bg-cyan-400 ring-2 ring-cyan-400/30 motion-safe:animate-pulse`
  - success dot (phase passed/approved, wrap-up): `bg-emerald-400`
  - hold dot (parked): `bg-amber-400`
  - error dot: `bg-rose-400`
- **Iconography.** One lucide icon per line, `h-3.5 w-3.5 text-slate-500`, `aria-hidden`. Icons by kind (phase = `FileText`/`CheckCircle2`/`Clock3`; status = `Activity`; tool = per-tool map in §5; complete = `CheckCircle2`; error = `TriangleAlert`). **No emoji anywhere in the stream.**
- **Typography.** `text-xs` (12px) `leading-relaxed`. Status prose `text-slate-400`; emphasized fragments (phase names, filenames, scores) `text-slate-300 font-medium`. No `uppercase`, no `tracking-wide`. Nothing below 12px.
- **Opacity rhythm (static, zero animation cost).** All feed lines render `opacity-80` except the **newest** activity line, which renders `opacity-100` and (while the run is live) carries the pulsing cyan dot. This gives a gentle "recency depth" cue with no re-animation — opacity classes are set at render time from the entry index.
- **Differentiation from user/AI messages.** User = right-aligned sky card; AI = left slate card with cyan avatar header. Activity = borderless left-dotted rail on `bg-transparent`, low icon contrast, no header. It reads as *machine hum*, not as another speaker.
- **Hover:** `hover:bg-slate-900/40` rounded-md, purely optional affordance; lines are **non-interactive** (no buttons inside activity lines).

### 3.2 Live indicator on the newest line

When the run is live (`autopilotStatus.running`), the newest activity line gains a small, normal-case chip after the prose:

```tsx
{isLive && running && (
  <span className="self-center shrink-0 rounded-full border border-cyan-800/60 bg-cyan-950/60 px-2 py-px text-[10px] font-medium text-cyan-300">
    auto-drafting
  </span>
)}
```

The HUD rail (AutopilotHud) remains the *structural* phase locus ("which dot am I on"); the chat-side pulsing dot + chip is the *narrative* "it's moving right now" cue. Two signals, same cyan language, no duplication of the 13-dot rail.

### 3.3 Distinct, warm error treatment ("Needs attention", not "System")

Parked phases and soft failures use a **restrained amber block** (never rose):

```tsx
<div role="alert" className="mt-1 flex items-start gap-2 rounded-lg border border-amber-800/70 bg-amber-950/40 px-3 py-2 text-xs">
  <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
  <div className="min-w-0">
    <p className="text-[11px] font-bold text-amber-300">Needs attention</p>
    <p className="mt-0.5 break-words text-amber-200/90">{reason}</p>
  </div>
</div>
```

Hard failures (turn error, connection loss) use the identical block with the rose accent swapped in and the label **"Something went wrong"**. One block component, two tone params.

### 3.4 Wrap-up line

```tsx
<div className="flex items-start gap-2 rounded-md border border-emerald-900/60 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-300">
  <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
  <p className="break-words">{summary}</p>
</div>
```

---

## 4. Exact status copy — full mapping table

All rows below must be **natural, first-person-agent, gerund-predicate English** per the user's approved voice ("Adding this requirement…", "Checking this constraint…", "Comparing against the approved baseline…"). The same `onStatusUpdate` feeds the interactive-turn busy chip and the CLI spinner, so every string must read cleanly in both contexts.

### 4.1 `src/core/runner.ts` (status updates)

| # | File:Line | Current | Proposed |
|---|-----------|---------|----------|
| 1 | runner.ts:207 | `Classifying request...` | `Figuring out who should handle this…` |
| 2 | runner.ts:260 | `Running mandatory project discovery...` | `Skimming the project folder for related documents and decisions…` |
| 3 | runner.ts:345 | `` `Compacted session (${tokensBefore} → ${tokensAfter} tokens)` `` | `Tidying up the conversation history so there's room to work…` |
| 4 | runner.ts:348 | `` `Executing specialist: ${specialist.name}...` `` | `` `Asking ${specialist.name} to prepare the first draft…` `` |
| 5 | runner.ts:491 | `Running harsh critic evaluation with program alignment...` | `Comparing the draft against the approved project baseline…` |
| 6 | runner.ts:575 | `` `Critic requested improvements (Score: ${score}/10). Revising draft (Attempt ${attempts}/${maxAttempts})...` `` | `` `Baseline review suggests refinements (score: ${score}/10). Polishing — pass ${attempts} of ${maxAttempts}…` `` |

Real progress preserved: score (`${score}/10`) and attempt count (`pass ${a} of ${m}`) stay in #6 verbatim; "polishing" keeps the retry semantics without the word "critic". Note line 150 `/compact` response (`✓ Compacted session…`) is a system reply, not an `onStatusUpdate` string — leave it.

### 4.2 `src/core/autopilot.ts` (driver events)

| # | File:Line | Current | Proposed |
|---|-----------|---------|----------|
| 7 | autopilot.ts:271 | `` `Retrying ${phase.name} with stronger output instruction…` `` | `` `The first pass didn't produce a usable ${phase.name} document — retrying with clearer instructions…` `` |
| 8 | autopilot.ts:227,343,377 | phase events carry `phaseId` + `status` only | **add `name: phase.name`** to each `{kind:'phase'}` emit so chat can render friendly phase names |
| 9 | autopilot.ts:256,317,386 | `{kind:'complete', result:{passed,parked}}` | **add `reason: 'finished' | 'stopped'`** (set `'stopped'` in the abort branch at :256/:317, `'finished'` at :386) so chat can distinguish "All done" from "Stopped". Type change in the `AutopilotEvent` union (line 18). |
| 10 | autopilot.ts:335,352 | `` `Phase ${id} blocked: …` `` / `` `Phase ${id} produced no document` `` | Pass through unchanged; the **web renderer** strips the machine prefix and re-frames as "Needs attention — {reason}" |

### 4.3 Web-rendered event lines (DevelopmentView.tsx)

| Event | Proposed line |
|-------|---------------|
| `start` | `Auto-drafting started — working through the phases in order…` |
| `phase: drafting` | `Drafting ${phaseName}…` |
| `phase: critic` | `Reviewing the ${phaseName} draft…` |
| `phase: revising` | `Polishing ${phaseName} after the review…` |
| `phase: passed` | `${phaseName} completed` |
| `phase: auto-approved` | `Approved ${phaseName} — continuing…` |
| `phase: parked` | `Held ${phaseName} for your review` |
| `complete` (finished) | `All done — {n} documents finalized` (+ `, {m} on hold for review`) |
| `complete` (stopped) | `Stopped — {n} finalized so far` (+ `, {m} on hold`) |
| `error` | `Something went wrong — {reason}` (Needs-attention block; reason de-prefixed of `Phase X ...:` / raw `err.message`) |

### 4.4 Graceful fallback for any unseen string

Anything the UI can't classify (future core strings, LLM-passed prose) renders as the **calm note line**:

> Strip leading decorative symbols (`🔍`, `✓`, `⚠`, `✎`, `✔`, `🚀`, `☑`) from the start of the string, then render icon `Activity` + prose in slate-400, dot `slate-600`. Never fail, never render raw JSON.

Backend convention note (one rule for all future `onStatusUpdate` call sites): *first-person present tense, gerund predicate, name the thing being acted on, no engine vocabulary* ("classify/execute/specialist/critic loop/mandatory"). If a number means progress (score, attempt, count), keep it — numbers are the concrete "real state".

---

## 5. Tool-call lines: emoji → icon map

`formatToolCall` returns `{ icon, text }` (currently returns emoji-prefixed strings). Full map — all icons from lucide-react (already in the bundle):

| tool(s) | icon | text |
|---------|------|------|
| `fs_read` | `BookOpen` | `Reading ${path}` |
| `fs_list` | `FolderOpen` | `Listing ${dir}` |
| `fs_write` | `FilePen` | `Writing ${path}` |
| `fs_edit` | `PenLine` | `Editing ${path}` |
| `state_read` | `Database` | `Checking project state` |
| `state_update` | `Save` | `Saving project state` |
| `example_reader`, `examples_list` | `Star` | `Reviewing quality examples` |
| `pdf_extract`, `doc_transcribe` | `FileText` | `Transcribing ${path}` |
| `web_search` | `Search` | `Searching: ${query}` |
| `web_fetch` | `Globe` | `Fetching ${url}` |
| *default* | `Wrench` | `${tool}` |

Same shorten-to-60-char truncation as today. Bonus (1 line): the busy-chip `toolActivity` pill currently shows the raw tool name — reuse the same label map for its fallback text.

---

## 6. Implementation shape (for the worker agent)

### 6.1 Typed metadata (web layer only)

`web/src/api/useTurnStream.ts` — extend `ChatEntry`:

```ts
export type ActivityKind =
  | 'live' | 'tool' | 'phase' | 'complete' | 'error' | 'note';

export interface ActivityMeta {
  kind: ActivityKind;
  phaseId?: string;
  phaseName?: string;   // friendly name, core-provided
  score?: number;       // critic score /10
  attempts?: number;
  maxAttempts?: number;
  passedCount?: number;
  parkedCount?: number;
  stopped?: boolean;
  reason?: string;      // error detail / park reason
  tool?: string;        // raw tool name
}

export interface ChatEntry {
  id: string;
  role: 'user' | 'agent' | 'system';
  specialistName?: string;
  text: string;
  activity?: ActivityMeta;   // NEW — present only on autopilot feed lines
  criticResult?: CriticResult;
  requiresReview?: boolean;
  aborted?: boolean;
}
```

`web/src/hooks/useAutopilotEvents.ts` — add `name?: string` to the `{kind:'phase'}` member of `AutopilotLiveEvent` (core sends it; server relays the whole event object untouched, verified in `router.ts` SSE fan-out).

### 6.2 Event → entry mapping (DevelopmentView `handleAutopilotEvent`)

Build structured entries instead of emoji strings:

```ts
const handleAutopilotEvent = useCallback((ev: AutopilotLiveEvent) => {
  switch (ev.kind) {
    case 'start':
      return appendEntry({ role: 'system', text: 'Auto-drafting started — working through the phases in order…',
        activity: { kind: 'phase' } });
    case 'phase':
      return appendEntry({ role: 'system', text: phaseLine(ev), // §4.3 table
        activity: { kind: 'phase', phaseId: ev.phaseId, phaseName: ev.name } });
    case 'status':
      return appendEntry({ role: 'system', text: ev.message,
        activity: { kind: 'live' } });
    case 'tool_call': {
      const { icon, text } = formatToolCall(ev.tool, ev.args); // icon may be unused; kind drives iconography
      return appendEntry({ role: 'system', text, activity: { kind: 'tool', tool: ev.tool } });
    }
    case 'complete':
      return appendEntry({ role: 'system', text: summaryLine(ev), // §4.3
        activity: { kind: 'complete', passedCount: ev.result.passed.length, parkedCount: ev.result.parked.length, stopped: ev.reason === 'stopped' } });
    case 'error':
      return appendEntry({ role: 'system', text: ev.message, activity: { kind: 'error', reason: ev.message } });
    default:
      return; // question/parked already surface via portal + QuestionBar
  }
}, [appendEntry]);
```

A tiny classifier (`classifyLegacySystemNote(text) → ActivityMeta`) handles untagged `role:'system'` strings from other paths (`Error:`/`Connection error:` → error; `Draft approved`/`Saved`/`✔ Uploaded` → emerald `note`; else → calm `note`), preserving the checkpoint-accept and connection-loss messages with the same treatment language.

### 6.3 Renderer sketch

```tsx
// ActivityFeedEntry — the calm feed line (§3.1)
function ActivityFeedEntry({ entry, isLive, running }: { entry: ChatEntry; isLive: boolean; running: boolean }) {
  const m = entry.activity!;
  return (
    <div className={`relative flex items-start gap-2 py-[3px] pl-5 pr-2 text-xs leading-relaxed hover:rounded-md hover:bg-slate-900/40 ${isLive ? 'opacity-100' : 'opacity-80'}`}>
      <span aria-hidden className={`absolute left-1 top-[9px] h-1.5 w-1.5 rounded-full ${dotTone(m, isLive, running)}`} />
      <IconFor kind={m.kind} iconHint={m.tool} className="mt-[1px] h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
      <p className="min-w-0 flex-1 break-words text-slate-400">
        {renderActivityText(m)}        {/* phaseName/score/lines in text-slate-300 font-medium */}
        {isLive && running && (
          <span className="ml-2 inline-block self-center rounded-full border border-cyan-800/60 bg-cyan-950/60 px-2 py-px align-middle text-[10px] font-medium text-cyan-300">
            auto-drafting
          </span>
        )}
      </p>
    </div>
  );
}

// dotTone: error→bg-rose-400 · parked/complete-aborted→bg-amber-400 ·
//          complete-success→bg-emerald-400 · live+running→bg-cyan-400 ring-2 ring-cyan-400/30 motion-safe:animate-pulse ·
//          else bg-slate-600
```

In the `entries.map` where `role === 'system'`, branch: `entry.activity ? <ActivityFeedEntry/>` (`isLive = activityIndex === lastActivityIndex`), `: <LegacySystemNote/>` (classifier: error block, emerald note, or calm note). Update `chatEndRef` scroll to use `behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'`.

**Guardrails (what NOT to do):**
- Do not touch the user/AI bubble rendering, document pane, QuestionBar, or AutopilotHud.
- Do not create a second scroll region, drawer, or tab for activity.
- Do not add Markdown rendering or links inside activity lines (plain text, `break-words`).
- Do not change any backend API contract other than the two additive fields (`name`, `reason`) — both pass through the existing SSE relay untouched.
- Keep activity meta client-memory only (chat is already in-memory; nothing persists).

---

## 7. Accessibility

- **Live region:** the chat scroll container gains `aria-live="polite"` (or, cleaner, a visually-hidden `<div role="status" aria-live="polite">` updated with the newest activity text) so screen readers announce activity without interrupting typing. Announce the *prose*, never icons/dots.
- **Errors:** the Needs-attention block uses `role="alert"` — assertive announcement, once, as intended.
- **Icons:** every feed icon `aria-hidden="true"` + lucide `"aria-hidden"`; meaning lives in text. The dot rail is pure decoration (`aria-hidden`).
- **Contrast (verified on slate-950 `#020617` base):** `slate-400` text ≈ 7.5:1; `cyan-400` live dot/chip ≈ 12:1; `emerald-300/400` ≈ 9–10:1; `amber-300/400` ≈ 10–13:1; `rose-200/400` ≈ 8–9:1. All pass WCAG AA (text ≥4.5:1; icons as `slate-500` ≈ 4:1 non-text ≥3:1).
- **Motion:** pulse only under `motion-safe:` (Tailwind) → `prefers-reduced-motion: reduce` gets a static dot. No width/height animation, no layout shift (fixed heights: 6px dots, lines flow normally). Opacity "rhythm" is static classes, not animation.
- **Sizes:** feed lines are non-interactive (no focus targets); the unique 44px targets in the pane (input, send/abort, mic) are untouched.

---

## 8. Files touched (summary)

| File | Change | Type |
|------|--------|------|
| `src/core/runner.ts` | 6 status strings → natural English (§4.1) | core copy |
| `src/core/autopilot.ts` | retry string (§4.2#7); `name` on phase emits; `reason` on complete; `AutopilotEvent` union updated | core copy + 2 additive fields |
| `web/src/api/useTurnStream.ts` | `ActivityKind`/`ActivityMeta`; `ChatEntry.activity?` | web type |
| `web/src/hooks/useAutopilotEvents.ts` | `phase.name?` on `AutopilotLiveEvent` | web type |
| `web/src/views/DevelopmentView.tsx` | structured event mapping (§6.2); `ActivityFeedEntry`, `LegacySystemNote`, error block, wrap-up line; `formatToolCall` → `{icon,text}`; system-entry branch in render | web presentation |

Server (`router.ts`, `session.ts`, `index.ts`): **zero changes** — events relay verbatim; the additive fields are invisible to non-subscribers.

## 9. Acceptance checks

- [ ] No `role:'system'` entry renders with `rose` background or a "System"/`TriangleAlert` header.
- [ ] Every §4 string replaced; no `Classifying`, `Executing specialist`, `harsh critic`, `Mandatory` remains in `runner.ts`/`autopilot.ts` `onStatusUpdate` calls.
- [ ] Score + attempt + passed/parked + outcome visible in rendered lines (§4.3).
- [ ] Unseen core strings render via the calm fallback (§4.4) — never raw JSON, never a crash.
- [ ] Errors render as warm "Needs attention" blocks (`role="alert"`), not as the generic stream.
- [ ] `motion-safe:` gates all animation; contrast ratios in §7 hold.