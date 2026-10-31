# Revised-Doc Diff View — Implementation Plan (2026-10-31)

Source research: researcher brief 61b13d72 (b8ed8945 artifact). User decisions: red/green
line diff (GitHub style), no critic on ripple fixes, `revised` = approved + has diff.

## Goal
When a doc's status is `revised` (ripple-fixed without re-approval), the Engineering
Studio doc pane shows a banner + toggle rendering a line-level diff between the
LAST-APPROVED content and CURRENT disk content. Red = removed/original, green = added/new.

## Endpoint (server, thin)
`GET /api/docs/:phaseId/diff` → `{ phaseId, approved: string|null, current: string, approvedAvailable: boolean }`
- Raw strings only; hunks computed client-side (CLI could reuse raw strings later).
- Approved snapshot: scan `.starn/versions/<docName>-*.md` (newest-first), return newest
  whose SHA-256 matches the artifact's `approvedContentHash`; none → approved: null.
- Export `computeContentHash` from `src/workspace/state.ts:515` (one-line) or reimplement
  with node:crypto in a new `findApprovedBackup` util (`src/server/approved-snapshot.ts`).

## Touch map (files → changes)
1. `src/server/routes/docs.ts` — add GET branch `segments[3]==='diff'` (match() already covers).
   Tests: `tests/server-api.test.ts`, `tests/router-structure.test.ts` (ownPaths).
2. `src/server/approved-snapshot.ts` (NEW) — `findApprovedBackup(projectPath, docName, sha256): string|null`.
   Tests: extend `tests/version-backup.test.ts`.
3. `web/src/api/client.ts:52-55` — `fetchDocDiff(phaseId)`.
4. `web/src/types/api.ts` — `DocDiff` type (additive).
5. `web/src/lib/lineDiff.ts` (NEW) — `diffLines(before, after) → {type:'equal'|'added'|'removed', text}[]`;
   ~60-line LCS, no new deps. Tests: `web/src/lib/lineDiff.test.ts`.
6. `web/src/components/DocDiff.tsx` (NEW) — GitHub-style unified rows, monospace, red/green;
   theme tokens; reduced-motion safe. Tests: `web/src/components/DocDiff.test.tsx`.
7. `web/src/views/DevelopmentView.tsx` — (a) diff toggle in header actions (~1518);
   (b) "Revised — changes since approval" banner near docNotice (1549) when status==='revised';
   (c) `<DocDiff>` replaces `<Markdown>` at 1574-1578 when toggled; (d) lazy fetch on first toggle.
   Tests: `views/DevelopmentView.test.tsx`.
8. `web/src/lib/workflowState.ts:45-77` — `revised` branch AFTER parked/drafting checks;
   approved checks (rules 3-4) stay intact; no rail sub-flag (diff affordance lives in
   the doc pane). 'revised' counts as
   approved in `DocProgressBar.computeProgress`. Tests: `workflowState.test.ts`, `DocProgressBar.test.tsx`,
   `PhaseRail.test.tsx`.

## Design rules
- 'revised' = completed-not-approved per user decision ('move the doc from approved to
  completed, not approved'): needs-review rail mapping ('Completed — not approved'),
  diff affordance in the doc pane. Source of truth: worker 9863761f's branch in
  workflowState.ts (branch 2.5 after parked/drafting); supervisor-arbitrated 2026-10-31.
- No new dependencies. No green/blue in status chrome — red/green appear ONLY inside the
  diff content rows (code-review semantics, user-mandated).
- Banner must not collide with uploadNotice live region.
- Fallback: no matching snapshot → banner "Revised (original version not archived)" without diff.

## Gates
`npx vitest run` (root) → `npm --prefix web run test` → `npm --prefix web run build` → `npx tsc --noEmit`.
Then critic → live Playwright probe (toggle diff on a revised doc) → push.
