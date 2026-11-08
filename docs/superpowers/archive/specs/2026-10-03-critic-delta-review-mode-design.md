# Delta Review Mode for Critic Evaluator — Specification

**Date:** 2026-10-03  
**Status:** Approved in Brainstorming  
**Scope:** Core Critic (`src/core/critic.ts`), Core Runner (`src/core/runner.ts`), and test suite  

---

## 1. Problem Statement

STARN's `CriticEvaluator` currently uses a single monolithic evaluation prompt designed for brand-new, clean-sheet document drafting. Every time an artifact is submitted to the Critic, it evaluates the entire document against all rubric criteria from scratch.

When a specialist makes targeted edits to an already drafted or approved document (e.g., using `fs_edit` to incorporate answers to Section 6 Open Questions or user feedback):
1. **False Negatives & Score Regressions:** The Critic can re-litigate unchanged sections, penalize brief answers for not being multi-paragraph specifications, or fluctuate on subjective criteria, causing a high-scoring document (e.g. 9.0/10) to fail (e.g. 5.5/10).
2. **Cascading Auto-Revision Destruction:** A Critic failure triggers the automated revision loop, which instructs the model to "resolve all weaknesses". This can cause the specialist to rewrite or mutate sections that were never meant to change, reintroducing document drift and token waste.
3. **Lack of Intent Verification:** Full-generation evaluation assesses document completeness, but does not explicitly verify *intent fidelity*—whether the specific answers or feedback provided by the user in this turn were faithfully and accurately integrated.

---

## 2. Goals & Non-Goals

### Goals
- **Dual-Mode Review:** Explicitly distinguish between `full` generation review (new documents) and `delta` review (edits to existing documents).
- **Focused Delta Scrutiny:** In Delta mode, evaluate the changes based on three criteria:
  1. *Intent Fidelity:* Did the edits accurately incorporate the user's specific answers or feedback?
  2. *Internal Consistency:* Did the edits create internal contradictions or fail to update dependent statements?
  3. *Non-Regression & Anti-Hallucination:* Did the edits damage untouched specifications or inject fabricated vendor brands/unrequested parts?
- **Anti-Nitpicking Directive:** Direct the Critic not to fail or dock points for styling, depth, or formatting in sections that were untouched.
- **Score Anchoring:** Anchor the Delta score to the document's `priorScore`. If the edits are clean and consistent, preserve or improve the score ($\ge \max(8.0, \text{priorScore})$).
- **Surgical Auto-Revision:** If Delta evaluation fails, provide targeted revision guidance instructing the specialist to use `fs_edit` to fix the specific defect rather than rewriting the document.

### Non-Goals
- Bypassing the Critic on edits: All deliverable changes must still pass the Critic to guard against drift and hallucinations.
- Replacing the full rubric on clean-sheet drafts: Brand-new documents will continue to use the thorough `full` evaluation mode.

---

## 3. Architecture & Interface Changes

### 3.1 `src/core/critic.ts`

Extend `CriticEvaluateOptions`:
```typescript
export interface CriticEvaluateOptions {
  model: string;
  artifactContent: string;
  rubric: string;
  secretSauceExamples: string[];
  userExamples: string[];
  programBaselineDocuments?: BaselineDocument[];
  appliedEdits?: EditEntry[];
  signal?: AbortSignal;
  // Delta Review enhancements
  mode?: 'full' | 'delta';
  priorScore?: number;
  userPrompt?: string;
}
```

#### Delta Review Prompt Structure
When `options.mode === 'delta'`:
The Critic prompt changes from the clean-sheet evaluation prompt to a specialized Delta Review prompt:
- **Header:** Identifies the Critic as conducting a targeted Delta Evaluation on an evolved document baseline.
- **Context:**
  - `USER REQUEST / ANSWERS TO INCORPORATE`: Shows `options.userPrompt`.
  - `TARGETED EDITS APPLIED THIS TURN`: Shows `options.appliedEdits` (`old_text` -> `new_text` with line numbers).
  - `PRIOR BASELINE SCORE`: Shows `options.priorScore` (defaulting to 8.5 if not previously recorded).
  - `APPROVED PROGRAM BASELINE`: Upstream cross-document source of truth (unchanged).
- **Core Directives:**
  1. *Verify Intent Fidelity:* Ensure the applied edits fulfill the user's instructions or answers.
  2. *Check Document-Wide Consistency:* Verify that downstream or related sections in this document align with the edits.
  3. *Enforce Anti-Hallucination:* Penalize fabricated vendor brands or unrequested parts in the new text.
  4. *Anti-Nitpicking Directive:* Explicitly instruct the model: "Do NOT fail or dock points for styling, depth, or formatting in sections that were NOT touched by these edits. Focus your evaluation on the modified regions and their direct downstream dependencies."
  5. *Score Anchoring Rule:* If the edits cleanly address the feedback without introducing contradictions or hallucinations, score $\ge \text{priorScore}$ and pass. Only deduct points and fail if the edit itself is incomplete, contradictory, or introduces hallucinations.

When `options.mode !== 'delta'` (or undefined):
- Use the existing Full Generation prompt verbatim.

---

### 3.2 `src/core/runner.ts`

#### Determining Evaluation Mode
1. **Before Agent Loop:**
   - Detect whether the target artifact already exists on disk (`targetDocExistedBeforeTurn = targetDocMtimeBefore > 0`).
   - Query existing artifact record in `stateManager`:
     ```typescript
     const existingArtifact = state.artifacts.find(
       a => a.id.toUpperCase() === specialist.id.toUpperCase()
     );
     const priorScore = existingArtifact?.criticScore ?? 8.5;
     ```
2. **After Agent Loop:**
   - Determine mode:
     ```typescript
     const isDelta = targetDocExistedBeforeTurn && (
       (context.editLog && context.editLog.length > 0) || diskModified
     );
     ```
3. **Critic Call:**
   Pass the delta options to `critic.evaluate`:
   ```typescript
   criticResult = await critic.evaluate({
     model,
     artifactContent: artifactForCritic,
     rubric: specialist.criticRubric || '',
     secretSauceExamples: specialist.secretSauceExamples,
     userExamples: customExamples,
     programBaselineDocuments: programBaselineDocs,
     appliedEdits: context.editLog,
     signal,
     mode: isDelta ? 'delta' : 'full',
     priorScore: isDelta ? priorScore : undefined,
     userPrompt: isDelta ? userPrompt : undefined
   });
   ```

4. **Surgical Auto-Revision Prompt:**
   If `isDelta` is true and the Critic fails, construct a surgical revision prompt instead of a generic one:
   ```typescript
   const revisionPrompt = isDelta
     ? `The Critic evaluated your targeted edits to docs/${specialist.id.toUpperCase()}.md and found the following issues:\n` +
       `${(criticResult.weaknesses || []).map(w => `- ${w}`).join('\n')}\n\n` +
       `Actionable Guidance:\n${criticResult.actionableGuidance || 'Fix weaknesses'}\n\n` +
       `INSTRUCTION: Use the fs_edit tool to surgically resolve these specific issues in the document. Do NOT rewrite or regenerate the entire document.`
     : `The Critic evaluated your draft and found the following weaknesses:\n` +
       `${(criticResult.weaknesses || []).map(w => `- ${w}`).join('\n')}\n\n` +
       `Actionable Guidance:\n${criticResult.actionableGuidance || 'Fix weaknesses'}\n\n` +
       `Please revise the deliverable to resolve all weaknesses while maintaining rigorous physical engineering standards and program alignment.`;
   ```

---

## 4. Verification and Testing

### 4.1 Unit Tests (`tests/critic-delta.test.ts`)
- **Delta Prompt Generation:** Verify that calling `evaluate` with `mode: 'delta'` generates a prompt containing:
  - The Delta Evaluation header and anti-nitpicking directive.
  - The `userPrompt`.
  - The `appliedEdits` log.
  - The `priorScore` baseline score.
- **Full Mode Backward Compatibility:** Verify that calling `evaluate` with `mode: 'full'` or omitted `mode` produces the classic clean-sheet prompt without delta directives.
- **Score Anchoring Behavior:** Mock LLM response to confirm that score and pass/fail states parse cleanly under delta mode.

### 4.2 Runner Integration Test (`tests/core-loop.test.ts`)
- In an edit turn where an existing document is updated with `fs_edit`:
  - Assert `critic.evaluate` is called with `mode: 'delta'`, the document's prior score, and the user prompt.
  - Assert that on a failure, the revision prompt instructs surgical `fs_edit` rather than full rewrite.

---

## 5. Summary of Files Touched

| File | Changes |
| :--- | :--- |
| `src/core/critic.ts` | Add `mode`, `priorScore`, `userPrompt` to `CriticEvaluateOptions`. Add delta prompt template and branching logic. |
| `src/core/runner.ts` | Determine `isDelta` from file existence + edits; retrieve `priorScore`; pass to `critic.evaluate`; tailor `revisionPrompt`. |
| `tests/critic-delta.test.ts` | **New** — Comprehensive unit tests for Delta Review mode. |
| `tests/core-loop.test.ts` | Integration assertion that edit turns invoke Critic with delta options. |
