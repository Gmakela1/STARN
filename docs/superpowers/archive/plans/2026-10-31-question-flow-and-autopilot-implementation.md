# Question Flow, Autopilot Reliability & Studio States — Implementation Plan

Date: 2026-10-31 · Design: docs/superpowers/designs/2026-10-31-question-flow-and-autopilot-design.md
TDD. Gates per task: `npm --prefix web run test` → `npm --prefix web run build` → `npx tsc --noEmit` (+`npx vitest run` root for server tasks). Stage only your own files; one commit per task.

## Order & Dependencies
1. **T1 server reliability (roots of bugs 5a/6)** — unblocks answer apply + Start. No web deps.
2. **T2 web reliability follow-ups** (Start UX, draft persistence, queued chip survival) — depends on T1 API shape.
3. **T3 panel declutter** (#1,#2): rename to Agents Ready, drop echo + Back button.
4. **T4 voice input in answers** (#3).
5. **T5 status colors + follow-up history** (#4).
6. **T6 4th doc state** (#7).
7. **T7 STT model selection** (#8).
8. **T8 synthesis** — critic + security + live verify + push.

## T1 — Server turn-guard + queue drain (root cause)
Files: `src/server/session.ts`, `src/core/autopilot.ts`, `src/server/routes/autopilot.ts`, `tests/server-autopilot.test.ts`, `tests/autopilot-driver.test.ts` (if they cover the chain), plus a new regression test.
- `autopilotStop()` → call `endTurn()` (release guard) after controller abort.
- `runChain` (src/core/autopilot.ts L92-100/L197-207): acquire guard inside try/finally; on any exit without `complete`, emit `complete`-equivalent or release guard so `busy` can't persist with `running:false`.
- Add regression test: start chain that ends without complete → `busy` false, `/api/autopilot/start` succeeds next time.
- Answer drain: ensure `queueAnswer` drains when idle (not only at phase boundaries) — keep the idle drain path robust.
- `POST /api/autopilot/start` on held guard → 409 with actionable message (keep; client will surface it).
- SSE: remove answer-frame `skipBackfill` exclusion so reload preserves Queued chips.
Commit: `fix(core): release turn guard on autopilot stop and on chain exit; drain answers when idle`.

## T2 — Web reliability follow-ups
Files: `web/src/views/DevelopmentView.tsx` (Start/Stop, error surface, optimistic running), `web/src/components/QuestionPanel.tsx` (+ test), `web/src/layouts/AppShell.tsx` (draft/portal state lifting), `web/src/hooks/useAutopilotEvents.ts` (SSE queued chip), `web/src/components/QuestionBadge.tsx` (+ test).
- Start button: min-h-[44px] text-xs font-semibold bg-cyan-600 hover:bg-cyan-500, label "Start Auto-Drafting", aria `Start autopilot auto-drafting`, disabled while pending, no silent catch — inline `role="alert"` on failure with the exact copy from design §5.
- Panel drafts: persist per-item across close/reopen (AppShell/portal store keyed by item id; optionally localStorage). "Follow-up" keeps the history chain (see T5).
- Queued chip survives reload (render from SSE answer frames restore).
Commit: `fix(web): surface autopilot start errors, promote Start button, persist answer drafts`.

## T3 — Panel declutter
Files: `web/src/components/RunStateCluster.tsx` (+test), `web/src/components/TopBar.test.tsx`, `web/src/components/QuestionPanel.tsx` (+test), `web/src/views/DevelopmentView.tsx`.
- RunStateCluster ready word → "Agents Ready"; aria template `Agents status: ${word}`.
- QuestionPanel header: remove run-state echo (RunStateCluster usage + runState prop) — already shown top-right.
- Remove "Back to Open Actions" button, `onBackToQueue` prop, DevelopmentView prop pass.
Commit: `fix(web): rename ready state to Agents Ready, drop panel run-state echo and back button`.

## T4 — Voice input in answers
Files: `web/src/components/QuestionPanel.tsx` (+test), reuse `web/src/hooks/useVoiceRecorder.ts`.
- Mic button + Alt-hold in the answer composer; append transcribed text.
Commit: `feat(web): talk-to-text for answering open questions`.

## T5 — Status colors + follow-up history
Files: `web/src/components/QuestionPanel.tsx` (+test), `web/src/components/QuestionBadge.tsx` (+test), `web/src/types/api.ts` (PortalItem follow-up/status fields), maybe `web/src/lib/portalDetail.ts` (+test).
- Chip/lifecycle colors per design §3: queued=blue (sky-300/sky-950), applying=cyan spinner, resolved=emerald+8s→remove, failed=rose; "Follow-up" amber chip with saved history link; nav dot sky when queued.
- Icon+word always, never color alone.
Commit: `feat(web): lifecycle colors and follow-up history for answered questions`.

## T6 — 4th doc state in Studio
Files: `web/src/lib/workflowState.ts` (+test), `web/src/components/PhaseRail.tsx` (+test), `web/src/views/DevelopmentView.tsx` (dropdown state label), `web/src/types/api.ts` (semantics: passed/auto-approved + openQuestions>0 vs draft), check `src/server/routes/autopilot.ts`/`src/core/autopilot.ts` for gating on parked/flagged docs (must NOT gate).
- New rail/dropdown state "Completed, needs approval" — doc exists/passed/auto-approved, openQuestions > 0, not user-approved. Distinct from draft (no questions) and approved.
- Autopilot: confirm/no-change that this state never stops the chain; chain keeps going; user flagged.
Commit: `feat(web): completed-but-not-approved doc state with open questions, non-gating`.

## T7 — STT model selection for voice input
Files: `src/openrouter/models.ts`, `src/config.ts` (or wherever settings schema lives — follow existing), `src/server/session.ts` (transcribeAudio uses setting), `src/cli/voice.ts`, `web/src/views/SettingsView.tsx` (+test), `web/src/types/api.ts`.
- Merge `?output_modalities=transcription` fetch results into the live list (STT discoverable).
- New `voiceTranscribeModel` setting (default `openai/whisper-large-v3`); audio pipeline uses it; STT-only selector in Settings; OCR Transcriber role dropdown excludes audio models.
Commit: `feat(core,web): selectable speech-to-text model for voice input`.

## T8 — Synthesis
- Critic (brand consistency? no — critic: quality vs examples, anti-hallucination, cross-doc alignment) + security (audio endpoint, model id validation SSRF/IDOR) + supervisor re-runs all gates, live Playwright verification of: Start works after wedge fix, answer applies, draft survives close, colors, 4th state, STT selector, Agents Ready rename; push single batch.

## Deferred
- URL routing /studio?q=, PortalItem.section population, top-bar overflow, <lg overlay — unchanged scope.