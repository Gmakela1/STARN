# In-Memory Critic Guidance Propagation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propagate the Critic's summary, weaknesses, and actionable guidance into immediate conversation context (`sessionMessages` and checkpoint feedback) without polluting persistent project state (`state.json`), enabling specialists to fulfill user requests to implement critic suggestions.

**Architecture:** 
1. In `src/core/runner.ts`, when a turn completes with a `criticResult`, append a concise, structured Critic note to `updatedSessionMessages` so immediate follow-up prompts have full visibility into the review.
2. In `src/cli/checkpoint.ts`, when the user submits feedback at a checkpoint where a critic ran and provided actionable guidance or weaknesses, enrich the returned feedback text with the Critic's evaluation context.
3. Zero changes to persistent `state.json` or `ArtifactRecord` to prevent "zombie feedback" across future sessions.

**Tech Stack:** TypeScript (strict), Vitest.

**Spec/Design Reference:** In-chat bounded design approved by user (2026-10-03).

## Global Constraints

- Must pass `npm test` (`tsc --noEmit && vitest run`) without errors or warnings.
- `core/*` must remain presentation-agnostic and I/O-free (no imports from `cli/*`).
- No modification to `ArtifactRecord` or `state.json` schemas.
- Follow Test-Driven Development (TDD) for every step.

---

## File Structure

| File | Responsibility | Action |
| :--- | :--- | :--- |
| `src/core/runner.ts` | Appends ephemeral Critic evaluation context into `updatedSessionMessages`. | Modify |
| `tests/core-loop.test.ts` | Unit/integration tests verifying Critic evaluation context is preserved in `sessionMessages`. | Modify |
| `src/cli/checkpoint.ts` | Enriches checkpoint `feedback` string with current Critic evaluation details when available. | Modify |
| `tests/checkpoint-ui.test.ts` | Unit tests verifying checkpoint feedback enrichment. | Modify |

---

## Tasks

### Task 1: Append Ephemeral Critic Context to `sessionMessages` in `CoreRunner`

**Files:**
- Modify: `src/core/runner.ts`
- Test: `tests/core-loop.test.ts`

- [ ] **Step 1: Write failing test in `tests/core-loop.test.ts`**

Add a test asserting that `result.sessionMessages` includes a structured Critic summary note when a deliverable has undergone critic review:
```typescript
  it('appends critic evaluation summary and actionable guidance to sessionMessages', async () => {
    const docsDir = path.join(tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'Concept of Operations',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.0
    });
    stateMgr.completeIntake();

    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async (opts: any) => {
      const content = String(opts.messages[0]?.content || '');
      if (content.includes('Request Classifier for STARN')) {
        return { content: '{"specialistId":"conops","reason":"refine"}', raw: {} };
      }
      if (content.includes('CONOPS & Systems Architect Specialist') || content.includes('EXISTING BASELINE')) {
        return { content: '# Concept of Operations\n\nFull deliverable text.', raw: {} };
      }
      if (content.includes('Critic')) {
        return {
          content: JSON.stringify({
            passed: true,
            score: 8.9,
            summary: 'Strong CONOPS foundation.',
            strengths: ['Clear operational modes'],
            weaknesses: ['PTO spline dimension omitted'],
            actionableGuidance: 'Specify 1-3/8 inch 6-spline shaft in Section 3.2.'
          }),
          raw: {}
        };
      }
      return { content: '', raw: {} };
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Review the CONOPS',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      sessionMessages: []
    });

    const lastMsg = result.sessionMessages[result.sessionMessages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('[Critic Review for Concept of Operations]');
    expect(lastMsg.content).toContain('Score: 8.9/10');
    expect(lastMsg.content).toContain('Specify 1-3/8 inch 6-spline shaft in Section 3.2.');
    expect(lastMsg.content).toContain('PTO spline dimension omitted');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core-loop.test.ts -t "appends critic evaluation summary"`  
Expected: FAIL (`expected lastMsg.content to contain '[Critic Review...'`).

- [ ] **Step 3: Implement in `src/core/runner.ts`**

In `src/core/runner.ts`, where `updatedSessionMessages` is constructed (around line 540):
```typescript
    const updatedSessionMessages: ChatMessage[] = [
      ...sessionMessages,
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: finalOutput }
    ];

    if (criticResult) {
      let criticNote = `[Critic Review for ${specialist.name}]: Score: ${criticResult.score.toFixed(1)}/10.`;
      if (criticResult.summary) {
        criticNote += `\nSummary: ${criticResult.summary}`;
      }
      if (criticResult.weaknesses && criticResult.weaknesses.length > 0) {
        criticNote += `\nWeaknesses:\n${criticResult.weaknesses.map(w => `- ${w}`).join('\n')}`;
      }
      if (criticResult.actionableGuidance) {
        criticNote += `\nActionable Guidance: ${criticResult.actionableGuidance}`;
      }
      updatedSessionMessages.push({
        role: 'user',
        content: criticNote
      });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core-loop.test.ts -t "appends critic evaluation summary"`  
Expected: PASS.

- [ ] **Step 5: Run full core-loop tests**

Run: `npx vitest run tests/core-loop.test.ts`  
Expected: PASS (10 tests).

- [ ] **Step 6: Commit Task 1**

```bash
git add src/core/runner.ts tests/core-loop.test.ts
git commit -m "feat(runner): append in-memory critic review context to sessionMessages"
```

---

### Task 2: Enrich Checkpoint Feedback with Critic Findings in CLI

**Files:**
- Modify: `src/cli/checkpoint.ts`
- Test: `tests/checkpoint-ui.test.ts`

- [ ] **Step 1: Write failing unit test in `tests/checkpoint-ui.test.ts`**

In `tests/checkpoint-ui.test.ts`, add a test testing the checkpoint feedback enrichment helper function or behavior when feedback is returned with a critic result.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/checkpoint-ui.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement enrichment in `src/cli/checkpoint.ts`**

When the user enters feedback in `runHumanCheckpoint`, if `criticResult` exists and has `actionableGuidance` or `weaknesses`:
```typescript
    if (action === 'feedback') {
      const feedback = await promptInputWithVoice(
        'Enter your response / feedback for the agent:',
        options.client
      );

      let enrichedFeedback = feedback;
      if (criticResult && (criticResult.actionableGuidance || (criticResult.weaknesses && criticResult.weaknesses.length > 0))) {
        enrichedFeedback = `${feedback}\n\n[CRITIC EVALUATION FROM THIS CHECKPOINT]:\nScore: ${criticResult.score.toFixed(1)}/10\nSummary: ${criticResult.summary || 'Approved'}`;
        if (criticResult.weaknesses && criticResult.weaknesses.length > 0) {
          enrichedFeedback += `\nWeaknesses:\n${criticResult.weaknesses.map(w => `- ${w}`).join('\n')}`;
        }
        if (criticResult.actionableGuidance) {
          enrichedFeedback += `\nActionable Guidance: ${criticResult.actionableGuidance}`;
        }
      }

      userFeedback = enrichedFeedback;
      finalAction = 'feedback';
      promptActive = false;
      break;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/checkpoint-ui.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/cli/checkpoint.ts tests/checkpoint-ui.test.ts
git commit -m "feat(checkpoint): enrich user feedback with checkpoint critic scorecard"
```

---

### Task 3: Full Pipeline Verification & Type-Check

- [ ] **Step 1: Run `npm test` (`tsc --noEmit && vitest run`)**
- [ ] **Step 2: Rebuild distribution (`npx tsc`)**
- [ ] **Step 3: Push commits to `origin/master`**
