# Answer Feedback & Question Portal Readability — Design Spec

**Date:** 2026-11-02 · **Scope:** Question Portal UX — answer-queue feedback (Problem 1) + question readability & answer dialog (Problem 2) · **Stack:** React 18 + Tailwind (slate/sky/cyan/amber/rose/emerald) + lucide-react · **No new dependencies · No new backend model calls**

---

## 0. Source truth (verified against code on 2026-11-02)

- `web/src/components/QuestionBar.tsx` — bottom bar. Collapsed row (`Needs Input` + cyan count chip), expanded list of cards. Card renders `title`, raw `detail` in a cramped `<p className="mt-1 text-xs leading-relaxed text-slate-400">`, and an inline `rows={2}` textarea + submit button when `status === 'open'`.
- `handleSubmit` (≈line 58) has **no catch**: `try { await onSubmit(...) } finally { setAnsweringId(null) }`. A 409 rejection is swallowed; spinner clears; question stays open silently.
- `web/src/api/client.ts:34` — `call()` throws on `!envelope.success`, so the current 409 `'A turn is already in progress'` becomes an unhandled promise rejection.
- `src/server/router.ts:1144` — answer route short-circuits `if (session.busy) return fail(res, 409, ...)`.
- `web/src/hooks/useAutopilotEvents.ts` — `event: autopilot` frames are `JSON.parse`d and fired as `parsed.status ?? parsed` into (a) a `setStatus` merge (`{ ...prev, ...st }`) and (b) `onEvent?.(st)`. **Important:** any new `kind` value currently gets spread into `autopilotStatus` (pollutes the HUD state).
- `web/src/views/DevelopmentView.tsx` — `handleAutopilotEvent` (≈line 88) maps event kinds to `appendEntry({ role: 'system', text })`. There is a legacy S5 hack: a `useEffect` watching `portalItems` for `status === 'answered'` that shows a transient `answerNotice` + `docUpdateBanner`. That hack gets **replaced** by typed SSE entries (§1.6.5).
- `web/src/types/api.ts` `PortalItem` (actual, not the task sketch): `{ id, type: 'question'|'parked'|'flag'|'nonconformance', severity: 'blocking'|'normal', docPath?, section?, title, detail?, gaps?, threadId?, status: 'open'|'answered'|'dismissed'|'resolved', answer?, source, createdAt, updatedAt, meta? }`.
- `web/src/api/useTurnStream.ts` — `ChatEntry` supports an optional `activity?: ActivityMeta` (kind union today: `'live'|'tool'|'phase'|'complete'|'error'|'note'`). Extending that union with answer kinds is trivially additive and optional for this pass.
- Custom keyframes live in `web/src/index.css` (`.animate-question-arrive` etc.) → modal entrance keyframes go there.

---

# Part 1 — Answer feedback during autopilot

## 1.1 Product decision (backend contract — the worker implements against this)

- `POST /api/portal/:id/answer` **no longer returns 409 when busy**:
  - Not busy → `200 { success: true, data: { applied: true } }`
  - Busy    → `202 { success: true, data: { queued: true } }`
- Per-session FIFO answer queue; queued answers apply one at a time after the active turn ends.
- New SSE frames published through the existing `event: autopilot` stream (shape `{ status: { kind, itemId, ... } }`):
  - `{ kind: 'answer_queued', itemId, title }`
  - `{ kind: 'answer_applying', itemId }`
  - `{ kind: 'answer_applied', itemId, item, affectedDocs }`
  - `{ kind: 'answer_failed', itemId, error }`
- **Contract note:** `answer_applied` must be published for **every** successful apply, including immediate (non-busy) applies — the client's chat log is driven exclusively by that frame (§1.6.5), so it must not be skipped.

## 1.2 Per-item state machine (`AnswerState`)

```
idle ──submit POST──► inflight ──200 {applied}──► applied ──8s dwell──► (gone, item answered)
                        │
                        └──202 {queued}──► queued ──SSE applying──► applying ──SSE applied──► applied
                                              │                        │
                                              └──SSE failed────────────┘
              inflight ──POST throws (net/5xx)──► failed ──[Retry]──► inflight …
queued/applying ──SSE failed──► failed ──[Retry]──► inflight …
queued/applying ──30s no SSE + poll shows status='answered' (fallback)──► applied
```

```ts
// web/src/views/DevelopmentView.tsx (new)
type AnswerPhase = 'queued' | 'applying' | 'applied' | 'failed';
interface AnswerState { phase: AnswerPhase; error?: string }
const [answerStates, setAnswerStates] = useState<Record<string, AnswerState>>({});
```

No entry in the map = idle. Map lives in **DevelopmentView** (SSE handler lives there); the whole map is passed down to `QuestionBar` as one prop. QuestionBar stays presentational for state.

## 1.3 Calibration — where each stage surfaces (the design decision)

| Stage | Surface | Why |
|---|---|---|
| POST in flight | spinner inside the modal footer button only (<300 ms typical) | transient, sub-second |
| `queued` | **per-item chip** on the card + **counter chip** on the collapsed bar | anchored to the item; zero scroll noise |
| `applying` | per-item chip swaps to cyan pulse | same anchor, motion = "it's moving now" |
| `applied` | chip → emerald; item dwell-“Resolved” (existing S5 animation) | anchored outcome |
| `failed` | rose chip + Retry **on the card** + **one chat entry** | failure must never be invisible, even when the bar is collapsed |
| applied/failed | **one chat entry each** (and only these two) | history log records outcomes, not heartbeats |

**Why not chat entries for queued/applying?** A live autopilot run emits a feed line every phase and tool call. Adding one line per answer stage would interleave *two* parallel narratives in one feed and bury the real signals. **Why not chips-only?** Outcomes that happen while the bar is collapsed would be invisible — which is precisely the current bug. So: **the bar shows live progress, the chat logs only terminal outcomes.** One feed entry for `applied`, one for `failed`, zero for `queued`/`applying`.

## 1.4 UI shapes

### 1.4.1 Per-item state chip (expanded card, header row)

Rendered next to the card header label (`AI needs input`), from `answerStates[item.id]`:

```tsx
const stateChip: Record<AnswerPhase, { icon: typeof Clock3; label: string; cls: string; live?: boolean }> = {
  queued:   { icon: Clock3,          label: 'Queued — applies after this phase', cls: 'border-amber-700/50 bg-amber-950/40 text-amber-300' },
  applying: { icon: Loader2,         label: 'Applying…',                        cls: 'border-cyan-700/50 bg-cyan-950/40 text-cyan-300' },
  applied:  { icon: Check,           label: 'Applied',                           cls: 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300' },
  failed:   { icon: TriangleAlert,   label: "Couldn't apply",                    cls: 'border-rose-700/50 bg-rose-950/40 text-rose-300' },
};

// render, next to the header icon/label span:
<span className={`inline-flex min-h-[24px] items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${chip.cls}`}>
  <chip.icon className={`h-3 w-3 ${chip.live ? 'animate-spin' : ''}`} aria-hidden />
  {chip.label}
</span>
```

- `applying` uses `Loader2 animate-spin` (mirrors the submit spinner; reads as motion, matches the cyan "live" language of the activity stream).
- Track: `text-[11px]` minimum (matches bar scale, ≥11px = the app's floor; interactive Retry below is a button, larger hit area).

**Failed chip gets a Retry action** (interactive, inside the chip):

```tsx
{phase === 'failed' && (
  <button
    onClick={() => void retry(item.id)}
    className="inline-flex min-h-[24px] items-center gap-1 rounded-full border border-rose-600/60 bg-rose-950/60 px-2 text-[11px] font-semibold text-rose-200 hover:bg-rose-900/70 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
  >
    <RotateCcw className="h-3 w-3" aria-hidden /> Retry
  </button>
)}
```

Retry replays the last submitted text (`submittedText: Record<id, string>` kept locally in QuestionBar, see §1.6.3).

### 1.4.2 Queue counter on the collapsed bar

The collapsed row already shows `Needs Input` + cyan open-count. Add an amber queue chip **only when** `queuedCount = stateCount('queued') + stateCount('applying') > 0`:

```tsx
{queuedCount > 0 && (
  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
    <Clock3 className="h-3 w-3" aria-hidden />
    {queuedCount} queued
  </span>
)}
```

- Inserted immediately after the `Needs Input` label (before the `ml-auto` cyan count).
- **Checkpoint mode** (the early `h-8` compact branch): append amber text to the existing pending badge → `{n} pending · {m} queued`. One `<span>` line change.
- Failed items are **not** counted here — they remain `status: 'open'`, so they stay visible in the existing cyan pending count, and the failure always gets a chat entry (visible even when collapsed). The collapsed bar therefore can never hide a failure.

### 1.4.3 Chat feed entries (outcomes only)

New kinds handled in `handleAutopilotEvent` (see §1.6.2). Exact copy — natural English, no emoji, consistent with the live-activity-stream voice (em-dash connector, lowercase doc name):

| Event | Chat text |
|---|---|
| `answer_applied` + `docPath` | `Answer applied to {basename(docPath)} — scanning downstream docs…` |
| `answer_applied`, no `docPath`, `affectedDocs.length >= 1` | `Answer applied — also updated {basename(affectedDocs[0])}.` |
| `answer_applied`, neither | `Answer applied — incorporated into the run.` |
| `answer_failed` | `Couldn't apply your answer to "{title}" — {error}. Retry from the question bar.` |

Rendered exactly like today's system entries (`appendEntry({ role: 'system', text })`). Optionally (follow-up polish, not required): extend `ActivityMeta['kind']` with `'answer_applied' | 'answer_failed'` so the future feed-line treatment renders a lucide `FileCheck2`/`TriangleAlert` instead of card chrome. Copy is designed to survive that change unchanged.

## 1.5 Accessibility for queue feedback

- One visually-hidden live region in `QuestionBar` root:
  ```tsx
  <span aria-live="polite" className="sr-only">{announcement}</span>
  ```
  `announcement` set by a small effect watching `answerStates`: latest *transition* phrase, e.g.
  - → queued: `Answer queued#. Will apply after the current phase finishes.`
  - → applying: `Applying answer to the document.`
  - → applied: `Answer applied.`
  - → failed: `Couldn't apply your answer.# ${error}`
  (Punctuation `#.` inserted so the SR voice drops before the article — write `Answer queued. Will apply…`; the `#` is just to flag intonation in this spec.)
- Chip contents (icon `aria-hidden` + text label) are themselves readable; the live region carries the announcement, the chips carry the persistent state label.
- Counter chip is a static badge (no live region — a per-keystroke-count announce would be noise); its meaning is repeated in the live-region transition phrase.
- All chip text contrasts ≥ 4.5:1 on `slate-900` (`amber-300`, `cyan-300`, `emerald-300`, `rose-300` on `*-950`/`slate-950` backgrounds all pass).

## 1.6 Wiring

### 1.6.1 `web/src/api/client.ts` (+ `types/api.ts`)

```ts
// types/api.ts (trivially additive)
export type PortalAnswerResult = { queued: true } | { applied: true };

// client.ts — return type change only; `call()` already unwraps envelope.data
submitPortalAnswer: (id: string, answer: string) =>
  call<PortalAnswerResult>('POST', `/api/portal/${encodeURIComponent(id)}/answer`, { answer }),
```

### 1.6.2 `web/src/hooks/useAutopilotEvents.ts` — guard status merge

Today `parsed.status ?? parsed` is spread into `autopilotStatus` (`{ ...prev, ...st }`). Answer frames must **not** touch status (would corrupt the HUD). Two-line change in the `case 'autopilot':` block:

```ts
const st = parsed.status ?? parsed;
const isAnswerFrame = typeof st?.kind === 'string' && ['answer_queued','answer_applying','answer_applied','answer_failed'].includes(st.kind);
if (isAnswerFrame) { onEvent?.(st); break; }   // answer frames: forward only, never merge into status
```

Also extend the exported `AutopilotLiveEvent` union with the four answer kinds (typed payloads `{ kind: 'answer_queued'; itemId: string; title: string }` etc.).

### 1.6.3 `QuestionBar.tsx` — new props + retry text

```ts
export interface QuestionBarProps {
  items: PortalItem[];
  onSubmit: (id: string, answer: string) => Promise<void>;   // now resolves on 200/202 (never 409)
  onDismiss: (id: string) => Promise<void>;
  onResume?: (docId?: string) => void;
  onEditDoc?: (docId?: string) => void;
  checkpointVisible: boolean;
  answerStates?: Record<string, AnswerState>;   // NEW — from DevelopmentView
}
```

- Add `const [submittedText, setSubmittedText] = useState<Record<string, string>>({})` — capture text on submit, keep it until applied (retry needs it past the `failed` frame). Delete the entry when the item's phase reaches `applied`.
- `handleSubmit` becomes: save `submittedText[id]`, `await onSubmit(...)` (no catch needed — DevelopmentView's handler converts *both* success shapes and any throw into `answerStates`), keep the existing dwell (`resolvedIds`) for the `applied` path.
- Remove the inline `rows={2}` textarea + 36px submit button (§2.3.3 replaces them).

### 1.6.4 `DevelopmentView.tsx` — handler + submission wrapper

```ts
const handleQueueAnswer = async (id: string, text: string): Promise<void> => {
  try {
    const res = await api.submitPortalAnswer(id, text);
    setAnswerStates(prev => ({ ...prev, [id]: { phase: res.queued ? 'queued' : 'applied' } }));
    await refreshDoc();                 // keep existing refresh behavior
  } catch (err) {
    setAnswerStates(prev => ({ ...prev, [id]: { phase: 'failed', error: (err as Error).message } }));
    appendEntry({ role: 'system', text: `Couldn't send your answer — ${(err as Error).message}.` });
  }
};
```

`handleAutopilotEvent` additions (the four kinds, §1.4.3 copy + `setAnswerStates` writes). **Delete the S5 `answerNotice`/`docUpdateBanner` effect** — it is a polling hack predicated on the item flipping to `answered`; the typed frames replace it (§1.6.5).

### 1.6.5 SSE-drop fallback (graceful degradation)

If the stream drops between `202` and the terminal frame, the chip would sit on `queued` forever. The existing 3s poll already refreshes `portalItems`; add one small effect:

```ts
useEffect(() => {
  for (const s of Object.entries(answerStates)) {
    const [id, st] = s as [string, AnswerState];
    if ((st.phase === 'queued' || st.phase === 'applying') && portalItems.find(i => i.id === id)?.status === 'answered') {
      setAnswerStates(prev => ({ ...prev, [id]: { phase: 'applied' } }));
    }
  }
}, [portalItems, answerStates]);
```

No chat entry from this path (the SSE `answer_applied` may still arrive and would double-log — dedupe by only logging from the SSE handler; on total stream loss the chip still resolves correctly, which is the point).

---

# Part 2 — Question readability + big answer window

## 2.1 Concise rendering — ONE recommendation (no LLM)

**Rule set: split into bullets client-side; bullets win; the answer dialog is the “read it fully” surface.**

New pure helper `web/src/lib/portalDetail.ts` (one file, no deps, used by both the card and the dialog):

```ts
export function renderDetail(detail: string): { bullets: string[]; overflow: number; full: string }
```

**Exact rules, in order:**

1. **Already a list?** Split on `\n`. If the raw text contains newlines, or any segment starts with `- `, `* `, `• `, or `/^\d+\.\s/` — treat each normalized segment as a bullet (strip the marker, capitalize first letter). Cap at **4**; the remainder becomes `overflow` (`+N more`).
2. **Clause/sentence split (the normal case).** Otherwise split on `/(?:[.;]\s+|\n+)/`, `map(trim).filter(Boolean)`.
3. **Bullet count:** if `segments.length >= 2` → take the **first 3** as bullets. If the final visible sentence exceeds **160 chars**, hard-cut it at **120 chars** and append `…`. Anything beyond bullet 3 goes to `overflow` (`+N more`).
4. **Single-sentence fallback (`segments.length === 1`):** no bullets. If ≤ 140 chars render the raw line; otherwise `line-clamp-2` + `Show full question`.
5. **No detail / `< 20` chars:** one plain line, no bullets, no toggle.

Rules are verbatim-split only — **no paraphrasing, no LLM, no new model calls.** `overflow > 0` or a cut sentence always exposes the full prose via the one `Show full question` toggle.

### 2.1.1 Card rendering (expanded item)

```tsx
{detail && (
  <div className="mt-1.5">
    <ul className="list-disc space-y-1 pl-3.5 text-xs leading-relaxed text-slate-300">
      {bullets.map((b, i) => <li key={i} className="pl-0.5">{b}{i === bullets.length - 1 && overflow > 0 ? ` +${overflow} more` : ''}</li>)}
    </ul>
    {(overflow > 0 || wasTruncated) && !openDetail && (
      <button onClick={() => setOpenDetail(id => (id === item.id ? null : item.id))}
        className="mt-1 text-[11px] font-medium text-sky-400 hover:text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-500/40 rounded">
        Show full question
      </button>
    )}
    {openDetail === item.id && (
      <p className="mt-1.5 rounded-md border border-slate-800 bg-slate-950/60 p-2.5 text-xs leading-relaxed text-slate-400">{detail}</p>
    )}
  </div>
)}
```

`wasTruncated` is true when any bullet was cut or rule 4 applied. Title stays `text-sm font-bold text-slate-200` (bump from `font-medium` — scannable first line). Bullet body `slate-300` (up from `slate-400` — reads better on `slate-950/10` cards, still ≥ 4.5:1).

### 2.1.2 Before / after (realistic example)

**Title:** `What operating voltage does the traction motor require?`

**Detail (raw, 4 sentences):**
> The traction motor for the electric tractor needs a defined operating voltage range before the BOM can be finalized. A 48V system would allow using the existing DC-DC converter and the current wiring harness, which minimizes changes. A 72V system could improve efficiency and reduce motor size, but it needs a new DC-DC converter and thicker gauge wiring. We should pick one value before locking the BOM.

**After (rule 2 → 3 bullets, 4th → overflow):**
```
What operating voltage does the traction motor require?        ← text-sm font-bold

• The traction motor needs a defined operating voltage range before the BOM can be finalized.
• A 48V system would allow using the existing DC-DC converter and the current wiring harness, which
  minimizes changes.
• A 72V system could improve efficiency and reduce motor size, but it needs a new DC-DC converter and
  thicker gauge wiring. +1 more
                               [ Show full question ]
```
Sentence 3 is < 160 chars so it stays whole; the 4th sentence ("We should pick one value…") is the dropped tail surfaced by `+1 more` / `Show full question`. Scan-able in one glance, full prose one click away — and the answer dialog shows the full prose anyway.

## 2.2 The answer dialog (modal) — bigger window, the ONLY answer surface

**Decision: the modal replaces the inline bar textarea entirely.** Rationale: (a) answers to these questions are 1–3 sentences — a `rows={2}`/36px hole is objectively too small (user said so); (b) one code path means queue feedback, submit errors, and focus management live in exactly one place; (c) the freed card space is what makes the concise rendering in §2.1 work. The card keeps an **Answer** button that opens the dialog. No proportional inline box, no dual surfaces.

### 2.2.1 Layout & exact classes

New component `web/src/components/AnswerDialog.tsx`. Props: `{ item: PortalItem; onSubmit: (id: string, text: string) => Promise<void>; onClose: () => void }`. Internal: `text`, `submitting`, `submitError`.

```
┌──────────────────────────────────────────────◄ w-[min(640px,calc(100vw-2rem))] ►───────────────┐
│  [icon] What operating voltage does the traction motor require?              [blocking] [X]   │
│  docs/ARCHITECTURE.md · asked while drafting                                          ← chips │
│                                                                                                │
│  • The traction motor needs a defined operating voltage range before the BOM …                  │
│  • A 48V system would reuse the existing DC-DC converter and wiring harness, …                  │
│  • A 72V system would improve efficiency but needs a new DC-DC converter …        [Show full]  │
│                                                                                                │
│  Your answer                                                                    ┌─┐            │
│  ┌───────────────────────────────────────────────────────────────────────────────┘ │            │
│  │  (textarea — min-h-[120px], grows, max-h-[240px])                              │            │
│  └─────────────────────────────────────────────────────────────────────────────────┘            │
│  (submitError row, only when set)                                                                │
│  [Cancel]                                                    [Send answer]                      │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Container + backdrop** (rendered via `createPortal`? **No** — plain conditional render at QuestionBar root is fine, the app renders no stacking contexts above it; use `z-50`):

```tsx
<div
  className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
  onMouseDown={e => { if (e.target === e.currentTarget && !text.trim()) onClose(); }}   // dirty-guard: backdrop only closes when empty
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby={`q-${item.id}-title`}
    aria-describedby={item.detail ? `q-${item.id}-detail` : undefined}
    className="flex max-h-[85vh] w-[min(640px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
  >
```

**Header** (shrink-0):

```tsx
<header className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
  <div className="min-w-0">
    <div className="flex items-center gap-2">
      <MessageSquare className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
      <h2 id={`q-${item.id}-title`} className="truncate text-sm font-bold text-slate-100">{item.title}</h2>
    </div>
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {item.docPath && <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{item.docPath.split('/').pop()}</span>}
      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">asked while {item.section ?? 'this phase'}</span>
      {item.severity === 'blocking' && (
        <span className="rounded border border-rose-700 bg-rose-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">BLOCKING</span>
      )}
    </div>
  </div>
  <button onClick={onClose} aria-label="Close question" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40">
    <X className="h-4 w-4" aria-hidden />
  </button>
</header>
```

**Body** (scrollable): bullets via the §2.1 helper (`id="q-{id}-detail"`), same `Show full question` toggle, then the form:

```tsx
<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
    {/* §2.1.1 bullets + Show full toggle, id=q-{id}-detail */}
  </div>
  <div className="space-y-1.5">
    <label htmlFor={`q-${item.id}-answer`} className="text-xs font-semibold text-slate-300">Your answer</label>
    <textarea
      id={`q-${item.id}-answer`} ref={textareaRef}
      value={text} onChange={e => setText(e.target.value)}
      placeholder="Give the engineer a concrete direction — a spec value, a preference, a constraint… (Enter to send, Shift+Enter for newline)"
      disabled={submitting}
      className="min-h-[120px] w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/30 disabled:opacity-50"
    />
    <p className="text-[11px] text-slate-500" id={`q-${item.id}-hint`}>Usually 1–3 sentences is enough.</p>
  </div>
  {submitError && (
    <p role="alert" className="flex items-center gap-1.5 rounded-md border border-rose-800 bg-rose-950/40 px-2.5 py-1.5 text-xs text-rose-300">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {submitError}
    </p>
  )}
</div>
```

**Footer** (shrink-0, right-aligned):

```tsx
<footer className="flex justify-end gap-2 border-t border-slate-800 p-3">
  <button onClick={onClose} disabled={submitting}
    className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-sky-500/40">
    Cancel
  </button>
  <button onClick={() => void doSubmit()} disabled={!text.trim() || submitting}
    className="flex min-h-[44px] items-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-sky-400/50">
    {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Sending…</>) : 'Send answer'}
  </button>
</footer>
```

All interactive targets ≥ 44px min-height (buttons) or ≥ 32px with text-safe area; press targets ≥ 8px apart. No raw hex; all tokens in the existing palette.

### 2.2.2 Modal behavior & a11y

1. **Open:** `const [answerTarget, setAnswerTarget] = useState<PortalItem | null>(null)` in QuestionBar; the card's **Answer** button (`flex min-h-[36px] items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-500`) sets it and stores the trigger node in a ref for focus restore.
2. **Initial focus:** `useEffect` on mount → `textareaRef.current?.focus()` (moves to textarea; if no textarea content, still focuses). 
3. **Escape:** `window.addEventListener('keydown')` in the dialog: `if (e.key === 'Escape') onClose()` (guard `e.isComposing`).
4. **Focus restore:** on unmount, `triggerRef.current?.focus()`.
5. **Body scroll lock:** `document.body.style.overflow = 'hidden'` on mount, restore `''` on unmount.
6. **Backdrop:** closes only when the textarea is empty (dirty-guard prevents accidental answer loss); `Cancel`/`X`/`Esc` always close.
7. **Submit:**
   - `doSubmit`: set `submitting=true`; `await onSubmit(item.id, text)`; on resolve → `onClose()` + QuestionBar runs the state handoff from §1.6.3/§1.6.4 (the 202 queued path or the 200 applied path). 
   - On reject (network / 5xx — a 409 is now impossible by contract) → keep modal **open**, set `submitError`, `submitting=false`. Error row is `role="alert"`, adjacent to the source field.
8. **Focus trap:** full trap is out of scope (no new deps, per constraints). The *basics* — focus-on-open, Esc, focus-restore-on-close — are required. **Residual risk:** with a trap absent, Tab from the dialog reaches the page behind it; the dark backdrop + initial focus make discovery very unlikely. Noted as accepted.
9. **Entrance animation:** add to `web/src/index.css` next to `.animate-question-arrive`:
   ```css
   @keyframes dialog-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
   @keyframes backdrop-in { from { opacity: 0; } to { opacity: 1; } }
   ```
   Applied as `.animate-dialog-in` / `.animate-backdrop-in`; wrapped in `motion-reduce:animate-none`. 150 ms ease-out. No exit animation (state removal is instant — acceptable and avoids second-timer complexity).

### 2.2.3 The card's new footer (replaces the inline answer box)

```tsx
{!isParked && isPending && !isResolving && (
  <div className="mt-2 flex items-center gap-2">
    <button onClick={() => setAnswerTarget(item)}
      className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400/50">
      <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Answer
    </button>
    {answerStates[item.id] && stateChip(answerStates[item.id])}   {/* §1.4.1 chip sits here */}
  </div>
)}
```

Note nicety: if the item is already `queued`/`applying`, the Answer button label can read “Answer queued — will send when free” (disabled submit) inside the dialog. Optional; do not gate the pass on it.

---

# 3. Files touched

| File | Change |
|---|---|
| `web/src/views/DevelopmentView.tsx` | `answerStates` state + `AnswerState` type; `handleQueueAnswer` wrapper; four new `handleAutopilotEvent` kinds; delete S5 `answerNotice`/`docUpdateBanner` effect; add SSE-drop fallback effect; pass `answerStates` to `QuestionBar`; wire `handleQueueAnswer` as `onSubmit`. |
| `web/src/components/QuestionBar.tsx` | `answerStates` prop; remove inline textarea+submit; add Answer-button → dialog; per-item chips + collapsed queue counter (+ checkpoint-mode suffix); `submittedText` retry map; `renderDetail` usage; `aria-live` region. |
| `web/src/components/AnswerDialog.tsx` | **NEW** (§2.2). |
| `web/src/lib/portalDetail.ts` | **NEW** `renderDetail` helper (§2.1). |
| `web/src/hooks/useAutopilotEvents.ts` | guard answer frames out of `setStatus`; extend `AutopilotLiveEvent` union with 4 answer kinds. |
| `web/src/api/client.ts` | `submitPortalAnswer` → `PortalAnswerResult`. |
| `web/src/types/api.ts` | add `PortalAnswerResult` (trivially additive; `PortalItem` shape untouched). |
| `web/src/index.css` | `dialog-in`/`backdrop-in` keyframes (2 small blocks). |

Scope guard: **no changes** to the Dashboard action pane or Shop Floor flags; parked-card paths in `QuestionBar` (`Resolve & Resume` / `Edit Manually` / gaps) stay byte-identical; server files not touched by this pass (backend contract in §1.1 is a *precondition* the backend implements in parallel).

# 4. Backend contract (precondition)

As §1.1: drop the 409 busy-short-circuit on the answer route; return `202 {queued}` / `200 {applied}` inside the existing `success:true` envelope; maintain per-session FIFO apply-after-turn; publish the four `event: autopilot` answer frames (including `answer_applied` for **immediate** applies).

# 5. Acceptance checks

**Queue feedback (Problem 1)**
- [ ] Start autopilot; submit an answer from the dialog. Within ~500 ms the card chip shows `Queued — applies after this phase` (amber) and the collapsed bar shows `1 queued` (amber, Clock3). No unhandled promise rejection in console.
- [ ] Chip transitions `queued → applying` (cyan spinner) → `applied` (emerald) as SSE frames land.
- [ ] Exactly **one** chat entry is appended for the whole cycle (`Answer applied to … — scanning downstream docs…`). No queued/applying entries.
- [ ] `answer_failed` path: rose chip + Retry on the card, one chat entry `Couldn't apply your answer to "…" — … Retry from the question bar.`; Retry re-submits the same text and re-enters the flow.
- [ ] Idle (not busy) submit: dialog closes, item dwell-“Resolved” (existing S5 animation), chip shows `Applied`, no queue chip ever appears.
- [ ] SSE-drop simulation (stop server after 202): chip resolves to `Applied` within ~3–6 s via the poll fallback.
- [ ] `autopilotStatus` object never contains `kind`/`itemId` fields (HUD unaffected).
- [ ] Collapsed bar + checkpoint mode show the queue suffix; a failure during collapse is still visible (chat entry + open count).
- [ ] Screen reader: transition phrases announced via the `aria-live` region; chips carry text labels.

**Readability & dialog (Problem 2)**
- [ ] Detail with ≥ 2 sentences renders as ≤ 3 bullets (+N more for overflow); single-sentence detail renders as a plain line; every rule has a visible `Show full question` toggle when text was truncated.
- [ ] Traction-motor example matches §2.1.2.
- [ ] Answer dialog: centered, `role="dialog"` `aria-modal`, backdrop-blur, `aria-labelledby` on title; textarea ≥ 120px tall and resizable; Esc closes; focus lands in textarea on open and returns to the Answer button on close; body scroll locked while open.
- [ ] Backdrop click with typed text does **not** close; with empty text it does.
- [ ] Network-failed submit keeps the dialog open with inline `role="alert"` error; 202/200 close it.
- [ ] No new npm dependencies anywhere (`package.json` diff = ∅).

# 6. Residual risks

- **Full focus trap not implemented** (manual focus + Esc + restore only) — accepted per constraints; noted in §2.2.2.8.
- **Event/timing races:** SSE `answer_applied` and the 3s poll can resolve the same answer; dedupe rule (chat entry only from SSE) prevents double-logging, but a chip could briefly show `Applying` after the item already flipped to `answered`. Cosmetic.
- **`affectedDocs` copy** falls back to a generic line if `docPath` and `affectedDocs` are both absent — backend contract should always populate at least one.
- **Backdrop dirty-guard** relies on the textarea being visibly the last interaction; if the user selects text and clicks the backdrop, the modal stays open (intended, no data loss).