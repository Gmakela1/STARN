# Critic Delta Review Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a dual-mode Critic that switches to a focused, score-anchored Delta Review mode when evaluating edits to an existing document, preventing score regressions, false-negative failures, and destructive full-document auto-revisions.

**Architecture:** `CriticEvaluateOptions` gains `mode?: 'full' | 'delta'`, `priorScore?: number`, and `userPrompt?: string`. In `delta` mode, the Critic uses an incremental review prompt focusing on Intent Fidelity, Internal Consistency, and Non-Regression, with an Anti-Nitpicking directive and score anchoring. `CoreRunner` automatically detects when an existing document is being updated, retrieves `priorScore` from state, passes the delta options to `critic.evaluate`, and issues surgical `fs_edit` revision prompts if auto-revision is needed.

**Tech Stack:** TypeScript (strict), Vitest. No external dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-critic-delta-review-mode-design.md`

## Global Constraints

- Must pass `npm test` (`tsc --noEmit && vitest run`) without errors or warnings.
- `core/*` must remain strictly presentation-agnostic and I/O-free (no imports from `cli/*`).
- Backward-compatible: `mode: 'full'` or omitting `mode` preserves exact existing clean-sheet evaluation behavior.
- Every task follows Test-Driven Development (TDD): failing test first, verify failure, minimal implementation, verify pass.

---

## File Structure

| File | Responsibility | Action |
| :--- | :--- | :--- |
| `src/core/critic.ts` | Interface options extension (`mode`, `priorScore`, `userPrompt`) and delta prompt generation logic. | Modify |
| `tests/critic-delta.test.ts` | Unit tests for delta evaluation prompt generation, score anchoring instructions, and full-mode compatibility. | Create |
| `src/core/runner.ts` | Detects delta conditions on existing artifacts, queries `priorScore`, passes delta options, constructs surgical auto-revision prompts. | Modify |
| `tests/core-loop.test.ts` | Integration test confirming edit turns invoke Critic with delta options and surgical revision guidance. | Modify |

---

## Tasks

### Task 1: Delta Review Prompt & Mode in `CriticEvaluator`

**Files:**
- Modify: `src/core/critic.ts`
- Test: `tests/critic-delta.test.ts`

**Interfaces:**
- Consumes: `EditEntry` from `src/tools/types.js`
- Produces: `mode?: 'full' | 'delta'`, `priorScore?: number`, `userPrompt?: string` on `CriticEvaluateOptions` in `src/core/critic.ts`.

- [ ] **Step 1: Write the failing unit tests for Delta Review Mode**

Create `tests/critic-delta.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { CriticEvaluator, CriticEvaluateOptions } from '../src/core/critic.js';
import { EditEntry } from '../src/tools/types.js';

describe('CriticEvaluator Delta Review Mode', () => {
  it('generates a specialized Delta Review prompt when mode is delta', async () => {
    let capturedPrompt = '';
    const mockClient = {
      chatCompletion: vi.fn(async (opts: any) => {
        capturedPrompt = opts.messages[0].content;
        return {
          content: JSON.stringify({
            passed: true,
            score: 9.0,
            summary: 'Edits accurately integrated with zero regressions.',
            strengths: ['Accurate PTO integration'],
            weaknesses: [],
            actionableGuidance: ''
          }),
          toolCalls: []
        };
      })
    } as any;

    const edits: EditEntry[] = [
      {
        path: 'docs/ARCHITECTURE.md',
        oldText: 'TBD: rear power delivery',
        newText: 'Rear 540 RPM PTO with independent clutch',
        matchedLineRange: { start: 50, end: 50 },
        timestamp: '2026-10-03T00:00:00.000Z'
      }
    ];

    const critic = new CriticEvaluator(mockClient);
    const options: CriticEvaluateOptions = {
      model: 'test-model',
      artifactContent: '# System Architecture\n\nRear 540 RPM PTO with independent clutch',
      rubric: 'Architecture Rubric',
      secretSauceExamples: [],
      userExamples: [],
      mode: 'delta',
      priorScore: 8.9,
      userPrompt: 'Use a rear 540 RPM PTO for power delivery',
      appliedEdits: edits
    };

    const result = await critic.evaluate(options);

    expect(result.passed).toBe(true);
    expect(result.score).toBe(9.0);

    // Delta-specific prompt verifications
    expect(capturedPrompt).toContain('DELTA EVALUATION');
    expect(capturedPrompt).toContain('USER REQUEST / ANSWERS TO INCORPORATE:');
    expect(capturedPrompt).toContain('Use a rear 540 RPM PTO for power delivery');
    expect(capturedPrompt).toContain('PRIOR BASELINE SCORE: 8.9/10');
    expect(capturedPrompt).toContain('TARGETED EDITS APPLIED THIS TURN');
    expect(capturedPrompt).toContain('Rear 540 RPM PTO with independent clutch');
    expect(capturedPrompt).toContain('Intent Fidelity');
    expect(capturedPrompt).toContain('Document-Wide Consistency');
    expect(capturedPrompt).toContain('Do NOT fail or dock points for styling, depth, or formatting in sections that were NOT touched by these edits');
    // Ensure clean-sheet generic header is NOT used in delta mode
    expect(capturedPrompt).not.toContain('apples-to-oranges');
  });

  it('preserves clean-sheet full review prompt when mode is full or omitted', async () => {
    let capturedPrompt = '';
    const mockClient = {
      chatCompletion: vi.fn(async (opts: any) => {
        capturedPrompt = opts.messages[0].content;
        return {
          content: JSON.stringify({
            passed: true,
            score: 8.5,
            summary: 'Initial draft approved',
            strengths: ['Complete coverage'],
            weaknesses: [],
            actionableGuidance: ''
          }),
          toolCalls: []
        };
      })
    } as any;

    const critic = new CriticEvaluator(mockClient);
    await critic.evaluate({
      model: 'test-model',
      artifactContent: '# System Architecture\nFull draft',
      rubric: 'Architecture Rubric',
      secretSauceExamples: [],
      userExamples: []
    });

    expect(capturedPrompt).toContain('Conduct an "apples-to-oranges" quality comparison');
    expect(capturedPrompt).not.toContain('DELTA EVALUATION');
    expect(capturedPrompt).not.toContain('PRIOR BASELINE SCORE:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/critic-delta.test.ts`  
Expected: FAIL (`TS2353: Object literal may only specify known properties, and 'mode' does not exist in type 'CriticEvaluateOptions'`).

- [ ] **Step 3: Implement Delta Mode in `src/core/critic.ts`**

Update `src/core/critic.ts`:
1. In `CriticEvaluateOptions`, add:
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
  mode?: 'full' | 'delta';
  priorScore?: number;
  userPrompt?: string;
}
```
2. In `CriticEvaluator.evaluate(options: CriticEvaluateOptions)`, implement prompt branching:
```typescript
    const isDelta = options.mode === 'delta';
    const priorScore = options.priorScore ?? 8.5;

    let prompt: string;
    if (isDelta) {
      let editsSummary = 'No specific edits recorded.';
      if (options.appliedEdits && options.appliedEdits.length > 0) {
        editsSummary = options.appliedEdits
          .map(e => `- [${e.path}] L${e.matchedLineRange.start}-${e.matchedLineRange.end}: "${e.oldText}" → "${e.newText}"`)
          .join('\n');
      }

      prompt = `You are the Harsh Critic for STARN, conducting a DELTA EVALUATION of targeted revisions to an existing engineering document.
A prior baseline for this document was already reviewed and achieved a quality score of ${priorScore}/10.
Your job is NOT to re-litigate unchanged sections, but to verify the integrity, accuracy, and consistency of this turn's changes.

USER REQUEST / ANSWERS TO INCORPORATE:
${options.userPrompt || '(Targeted revisions requested by user)'}

PRIOR BASELINE SCORE: ${priorScore}/10

TARGETED EDITS APPLIED THIS TURN:
${editsSummary}

CRITICAL DELTA REVIEW GUIDELINES:
1. Intent Fidelity:
   Verify that the edits faithfully incorporate the user's instructions or answers without omitting requested specifics, weakening engineering rigor, or inventing contradictory claims.
2. Document-Wide Consistency:
   Verify that downstream statements, specs, or tables within this document align with the edits. (For example, if a subsystem voltage or power source changed, confirm that dependent sections reflect this or remain valid).
3. Non-Regression & Anti-Hallucination:
   Verify that the edits did not delete essential requirements, introduce vague placeholders ("TBD"), or inject unrequested third-party vendor brand names/part numbers.
4. Anti-Nitpicking Directive (MANDATORY):
   Do NOT fail or dock points for styling, depth, or formatting in sections that were NOT touched by these edits. Focus your evaluation on the modified regions and their direct downstream dependencies.
5. Score Anchoring Rule:
   If the edits cleanly and accurately address the feedback without introducing contradictions or hallucinations, score >= ${priorScore}/10 and pass (score >= 8.0). Only deduct points and fail if the edits themselves are defective, contradict the user's intent, or break internal document consistency.

${baselineSection}
DRAFT ARTIFACT TO EVALUATE:
${options.artifactContent}

Respond ONLY with valid JSON in this exact structure:
{
  "passed": true | false,
  "score": number (0-10),
  "summary": "Concise verdict explanation focusing on the delta changes",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "actionableGuidance": "Specific instructions for the builder to fix weaknesses"
}`;
    } else {
      // Clean-sheet full review prompt
      prompt = `You are the Harsh Critic for STARN, an uncompromising engineering evaluation agent.
Your mission is to evaluate a drafted hardware/physical engineering project deliverable against strict engineering quality standards, verify program alignment, and enforce anti-hallucination discipline.

CRITIC GUIDELINES:
1. Conduct an "apples-to-oranges" quality comparison: judge standard of quality, completeness, technical rigor, clarity, and professionalism (not whether content matches examples identically).
2. Look for vague placeholders (e.g., "TBD", "approximate", "as needed"), lack of measurable specifications (dimensions, loads, power, temperatures), and missing physical considerations.
3. Program Alignment & Cross-Document Traceability:
   Verify that this deliverable strictly aligns with the parameters, dimensions, electrical voltages, power levels, environmental ranges, and user intent defined in the approved upstream project documents. Reject (score < 8.0) if the deliverable contradicts or ignores the approved program baseline.
4. Anti-Hallucination & Collaborative Integrity (CRITICAL):
   Penalize and fail (score < 8.0) any deliverable that invents specific third-party vendor brand names, part numbers, or unrequested subsystems (e.g., pyrofuses, complex vehicle CAN protocols, or unmentioned sensors) that were not specified by the user or established in the baseline. If critical engineering items are missing, the builder should suggest them as open questions/recommendations for the user rather than fabricating them as facts.
5. Pass (score >= 8.0) ONLY if the artifact meets or exceeds the engineering quality bar AND maintains strict grounding in user intent.

GRADING RUBRIC:
${options.rubric}
${baselineSection}
SECRET-SAUCE QUALITY EXAMPLES (Standard of Quality Reference):
${options.secretSauceExamples.map((ex, i) => `### Example ${i + 1}:\n${ex}`).join('\n\n')}

${options.userExamples.length > 0 ? `USER CUSTOM EXAMPLES:\n${options.userExamples.join('\n\n')}` : ''}
${editLogSection}
DRAFT ARTIFACT TO EVALUATE:
${options.artifactContent}

Respond ONLY with valid JSON in this exact structure:
{
  "passed": true | false,
  "score": number (0-10),
  "summary": "Concise verdict explanation",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "actionableGuidance": "Specific instructions for the builder to fix weaknesses"
}`;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/critic-delta.test.ts`  
Expected: PASS (2 tests).

- [ ] **Step 5: Run existing tests to ensure no regression**

Run: `npx vitest run tests/critic-edit-log.test.ts`  
Expected: PASS (2 tests).

- [ ] **Step 6: Commit Task 1**

```bash
git add src/core/critic.ts tests/critic-delta.test.ts
git commit -m "feat(critic): implement Delta Review mode with score anchoring and anti-nitpicking directives"
```

---

### Task 2: Runner Delta Review Integration & Surgical Auto-Revision

**Files:**
- Modify: `src/core/runner.ts`
- Modify: `tests/core-loop.test.ts`

**Interfaces:**
- Consumes: `mode`, `priorScore`, `userPrompt` options on `CriticEvaluator.evaluate`.
- Produces: Delta-mode Critic invocation and targeted auto-revision prompts on edit turns in `CoreRunner.executeTurn`.

- [ ] **Step 1: Write the failing integration test in `tests/core-loop.test.ts`**

In `tests/core-loop.test.ts`, add a test to the `Core Runner Intake & Multi-Turn` describe block:
```typescript
  it('invokes Critic in delta mode with prior score and surgical revision guidance on edit turns', async () => {
    const docsDir = path.join(tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(
      path.join(docsDir, 'CONOPS.md'),
      '# Concept of Operations\nBaseline',
      'utf-8'
    );
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'Concept of Operations',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.3
    });
    stateMgr.completeIntake();

    let capturedCriticPrompt = '';
    let capturedRevisionPrompt = '';

    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async (opts: any) => {
      const msg = opts.messages[0];
      const content = typeof msg.content === 'string' ? msg.content : '';

      // Classifier
      if (content.includes('Request Classifier for STARN')) {
        return { content: '{"specialistId":"conops","reason":"edit"}', raw: {} };
      }
      // Specialist turn (simulating an edit)
      if (content.includes('CONOPS & Systems Architect Specialist') || content.includes('EXISTING BASELINE')) {
        // If this is a revision loop call, capture the revision user prompt
        const userMsg = opts.messages.find((m: any) => m.role === 'user');
        if (userMsg && userMsg.content.includes('Critic evaluated your targeted edits')) {
          capturedRevisionPrompt = userMsg.content;
        }

        fs.writeFileSync(
          path.join(docsDir, 'CONOPS.md'),
          '# Concept of Operations\nBaseline with 540 RPM PTO',
          'utf-8'
        );
        return { content: 'I updated Section 3 for PTO.', raw: {} };
      }
      // Critic evaluation
      if (content.includes('Critic')) {
        capturedCriticPrompt = content;
        // Fail the first critic call to trigger auto-revision
        return {
          content: JSON.stringify({
            passed: false,
            score: 7.5,
            summary: 'Minor inconsistency in Section 4',
            strengths: [],
            weaknesses: ['Section 4 still mentions belt drive'],
            actionableGuidance: 'Update Section 4 to match PTO'
          }),
          raw: {}
        };
      }
      return { content: '', raw: {} };
    });

    await CoreRunner.executeTurn({
      userPrompt: 'Add a 540 RPM PTO to CONOPS',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      sessionMessages: []
    });

    // Critic prompt must be in delta mode with prior score and user prompt
    expect(capturedCriticPrompt).toContain('DELTA EVALUATION');
    expect(capturedCriticPrompt).toContain('PRIOR BASELINE SCORE: 9.3/10');
    expect(capturedCriticPrompt).toContain('Add a 540 RPM PTO to CONOPS');

    // Auto-revision prompt must instruct surgical fs_edit instead of full rewrite
    expect(capturedRevisionPrompt).toContain('targeted edits');
    expect(capturedRevisionPrompt).toContain('Use the fs_edit tool to surgically resolve');
    expect(capturedRevisionPrompt).not.toContain('Please revise the deliverable to resolve all weaknesses');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core-loop.test.ts -t "invokes Critic in delta mode"`  
Expected: FAIL (`expected capturedCriticPrompt to contain 'DELTA EVALUATION'`).

- [ ] **Step 3: Update `src/core/runner.ts` to wire Delta Review mode**

In `src/core/runner.ts`:
1. Before the agent loop, check if target document existed and capture prior score:
```typescript
    let targetDocMtimeBefore = 0;
    try {
      const filePath = path.join(projectPath, 'docs', `${specialist.id.toUpperCase()}.md`);
      if (fs.existsSync(filePath)) {
        targetDocMtimeBefore = fs.statSync(filePath).mtimeMs;
      }
    } catch (_e) { /* ignore */ }
    const targetDocExistedBeforeTurn = targetDocMtimeBefore > 0;
    const existingArtifact = state.artifacts.find(
      a => a.id.toUpperCase() === specialist.id.toUpperCase()
    );
    const priorArtifactScore = existingArtifact?.criticScore ?? 8.5;
```

2. When invoking `critic.evaluate(...)`:
```typescript
        const isDeltaReview = targetDocExistedBeforeTurn && (
          (context.editLog && context.editLog.length > 0) || diskModified
        );

        try {
          criticResult = await critic.evaluate({
            model,
            artifactContent: artifactForCritic,
            rubric: specialist.criticRubric || '',
            secretSauceExamples: specialist.secretSauceExamples,
            userExamples: customExamples,
            programBaselineDocuments: programBaselineDocs,
            appliedEdits: context.editLog,
            signal,
            mode: isDeltaReview ? 'delta' : 'full',
            priorScore: isDeltaReview ? priorArtifactScore : undefined,
            userPrompt: isDeltaReview ? userPrompt : undefined
          });
        } catch (err: any) {
```

3. When constructing `revisionPrompt` on critic failure:
```typescript
          const isDeltaReview = targetDocExistedBeforeTurn && (
            (context.editLog && context.editLog.length > 0) || diskModified
          );

          const revisionPrompt = isDeltaReview
            ? `The Critic evaluated your targeted edits to docs/${specialist.id.toUpperCase()}.md and found the following issues:\n` +
              `${(criticResult.weaknesses || []).map(w => `- ${w}`).join('\n')}\n\n` +
              `Actionable Guidance:\n${criticResult.actionableGuidance || 'Fix weaknesses'}\n\n` +
              `INSTRUCTION: Use the fs_edit tool to surgically resolve these specific issues in the document. Do NOT rewrite or regenerate the entire document.`
            : `The Critic evaluated your draft and found the following weaknesses:\n` +
              `${(criticResult.weaknesses || []).map(w => `- ${w}`).join('\n')}\n\n` +
              `Actionable Guidance:\n${criticResult.actionableGuidance || 'Fix weaknesses'}\n\n` +
              `Please revise the deliverable to resolve all weaknesses while maintaining rigorous physical engineering standards and program alignment.`;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core-loop.test.ts -t "invokes Critic in delta mode"`  
Expected: PASS.

- [ ] **Step 5: Run the full `tests/core-loop.test.ts` suite**

Run: `npx vitest run tests/core-loop.test.ts`  
Expected: PASS (all 9 tests).

- [ ] **Step 6: Commit Task 2**

```bash
git add src/core/runner.ts tests/core-loop.test.ts
git commit -m "feat(runner): wire Delta Review mode and surgical revision prompts for document edits"
```

---

### Task 3: Full Pipeline Verification & Type-Check

**Files:** None (pipeline verification).

- [ ] **Step 1: Run type-check and full test suite**

Run: `npm test`  
Expected: `tsc --noEmit` clean, and all 197+ tests in all test files PASS.

- [ ] **Step 2: Rebuild distribution files**

Run: `npx tsc`  
Expected: Clean compile into `dist/`.

- [ ] **Step 3: Commit and Push**

Push all commits to `origin master`.
