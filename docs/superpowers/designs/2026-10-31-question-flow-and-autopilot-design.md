# Question Flow, Autopilot Reliability & Studio States — Design

Date: 2026-10-31
Source: user request + research (researcher 17b8df03, UI/UX specialist 7663e421)

## Problems

1. **"AI Ready" echo** in the Open Questions panel header duplicates the top-right cluster; and the global label "AI Ready" should be "Agents Ready".
2. **"Back to Open Actions" button** in the Open Questions surface is confusing (routes to Dashboard) and the user wants it gone.
3. **No voice input** for answering open questions (exists for doc drafting).
4. **Status colors don't express lifecycle** — queued looks like "needs input" amber, no blue/green/follow-up state, follow-up answers lose history.
5. **BUG: queued answers never apply; closing the panel deletes the typed answer.** Proven root causes:
   - Wedged server turn-guard: `autopilotStop()` clears the controller but never `endTurn()`; a chain ending without emitting `complete` leaves `busy=true` + `running=false` permanently. `/api/autopilot/start` then 409s forever and answers queue into a dead drain.
   - `QuestionPanel` wipes drafts on any close (`surface==='closed' → setDrafts({})`).
   - SSE `skipBackfill` drops answer frames → reload clears the "Queued" chip.
6. **Autopilot Start button** swallows the 409 (`try{}catch{}`) and is a small 61×32 label; the HUD "Start Auto-Drafting" is not rendered anywhere.
7. **4th doc state missing** in the Studio dropdown: doc completed by autopilot but NOT user-approved, with open questions. Today it can wedge the chain or look like a draft.
8. **Transcription model choice:** STARN's "Transcriber" role is vision-OCR (PDF pages), not speech-to-text. STT models (Whisper V3 Turbo etc.) never appear because the OpenRouter default catalog excludes audio models; the voice pipeline hardcodes `openai/whisper-large-v3`. User wants selectable STT.

## Design

### 1. Nomenclature & panel declutter
- RunStateCluster ready word: **"Agents Ready"**; aria template `Agents status: ${word}`.
- QuestionPanel header: remove the run-state echo entirely (top-right cluster already shows it). Drop the `runState`/`RunStateCluster` usage in the panel.
- Remove "Back to Open Actions" button + `onBackToQueue` prop (DevelopmentView no longer passes it; tests updated).

### 2. Voice input in question answers
- Reuse `useVoiceRecorder` (same as doc dev): mic button in the answer composer + Alt-hold; transcribed text appends to the answer textarea.

### 3. Status color lifecycle (never color alone — icon+word)
- Queued/answered: **blue** (sky-300 on sky-950) — distinct from whatever is flagged.
- Applying: cyan + spinner (unchanged).
- Applied/resolved: **emerald**, 8s dwell, then removed from list.
- Failed: rose (unchanged).
- Follow-up questions on the same item: **amber "Follow-up"** chip with saved history link; answer stays attached to history, item returns to open state.
- Nav dot (QuestionBadge): stays amber-400 for pending, rose-400 for parked, sky-400 when any queued.

### 4. Reliability fixes (server)
- Session: `autopilotStop()` must release the turn guard (`endTurn()`), and the autopilot chain acquire/release the guard in a `finally` so a chain ending without `complete` (error/hang) can never wedge `busy`.
- `/api/autopilot` or start response surfaces a clear failure reason when the guard is held.
- Answer queue drains when idle regardless of how the previous turn ended.
- SSE: include answer frames in backfill so the Queued chip survives reload.
- Draft persistence: QuestionPanel drafts survive close/reopen (per-item, e.g. localStorage or kept state keyed by item id — kept in AppShell-level store so close/reopen preserves; history kept for follow-ups).

### 5. Autopilot Start control
- Keep in the DevelopmentView action cluster (proximity to phase rail).
- Promote to primary: `min-h-[44px] px-3.5 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500`, label **"Start Auto-Drafting"** (reuses HUD copy), aria `Start autopilot auto-drafting`.
- No `catch{}`: wire to `start()` with optimistic running state, disable while pending; inline `role="alert"` failure: "Couldn't start auto-drafting — a turn is already running. Press Stop or wait, then retry."
- HUD Start ("Start Auto-Drafting") may render only where currently placed; ensure no dead duplicate.

### 6. 4th studio document state
- New state in `railStateFor`/workflowState: **"Completed, needs approval"** — doc passed or auto-approved (exists), openQuestions > 0 (or not user-approved), distinct from plain draft.
- Autopilot must NOT gate/stop on this state (chain continues; user is flagged). A parked-with-questions doc is NOT a chain blocker; it's review-flagged.
- Dropdown shows the state label + flags the user can review/approve from there.

### 7. STT model selection (voice input, NOT the OCR role)
- `fetchLiveOpenRouterModels`: additionally fetch `https://openrouter.ai/api/v1/models?output_modalities=transcription` and merge results so `openai/whisper-large-v3-turbo`, `gpt-4o-transcribe`, `microsoft/mai-transcribe-2`, etc. are discoverable in the live list.
- Register a new setting, e.g. `voiceInputModel` with default `openai/whisper-large-v3`; `session.transcribeAudio` and CLI use it instead of the hardcoded slug; Settings gains a "Speech-to-text (voice input)" model selector (STT models only) with helper "Used for voice dictation in the Studio and question answers.".
- **Rename (display only, keep internal id):** the "Transcriber" role label becomes "Document OCR (scanned PDFs)" — internal role id stays `transcriber` so saved configs/API/tests don't break. Helper: "Reads text from scanned PDF pages.".
- The OCR role dropdown explicitly excludes audio models (vision-OCR stays as-is).
- Fallback `AVAILABLE_MODELS`/static additions: keep static STT set only inside the STT selector, not the general list.

## Non-goals
- No new runtime deps. Core stays I/O-agnostic (`node:`/`workspace`/`core` imports only).
- No chat-platform/Slack; no auth; no web search integration changes.
- No change to vision-OCR semantics of the Transcriber role.