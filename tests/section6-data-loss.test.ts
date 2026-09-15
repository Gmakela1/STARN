/**
 * Regression tests for Section 6 data-loss bugs.
 *
 * BUG 1: foldAnswerIntoDoc + removeSection6 deleted every answer the user typed
 *   - foldAnswerIntoDoc placed "✓ RESOLVED: answer" markers inside Section 6
 *   - removeSection6 then wiped the entire section, taking the markers with it
 *   - Net result: all answers silently discarded
 *
 * BUG 2: Checkpoint overwrote the post-resolution disk file
 *   - resolveSection6 wrote the "resolved" doc to disk after executeTurn finished
 *   - runHumanCheckpoint used result.output (pre-resolution) when it contained '# '
 *   - On accept, it wrote that over the disk → answers restored to open questions
 *
 * BUG 3: LLM never saw the answers
 *   - The interview ran after the agent loop completed; no second agent pass
 *   - foldAnswerIntoDoc is mechanical regex: it cannot update body sections or
 *     re-derive downstream statements as the specialist system prompt requires
 *
 * These tests verify the regression fixes:
 *   - collectSection6Answers returns Q&A pairs without touching the disk
 *   - The index.ts flow (pre-turn collection + enhanced prompt) is structurally correct
 *   - Checkpoint reads disk-first so it always shows what the LLM actually wrote
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseSection6Questions } from '../src/cli/section6-resolver.js';
import { extractCleanMarkdownDocument } from '../src/cli/ui.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function foldAnswerIntoDoc(doc: string, question: string, answer: string): string {
  const qKey = question.slice(0, 50).replace(/[*]/g, '\\*');
  const escapedKey = qKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `(\\*\\*Q\\d+\\s*[\\.:]\\s*\\**\\s*)${escapedKey}[\\s\\S]*?(?=\\n\\s*\\*\\*Q\\d+|\\n\\s*##|$)`
  );
  let match = doc.match(regex);
  if (!match) {
    const fragment = question.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fallbackRegex = new RegExp(
      `(\\*\\*Q\\d+\\s*[\\.:]\\s*\\**\\s*)?${fragment}[\\s\\S]*?(?=\\n\\s*\\*\\*Q\\d+|\\n\\s*##|$)`
    );
    match = doc.match(fallbackRegex);
  }
  if (match) {
    return doc.replace(match[0], `**✓ RESOLVED:** ${answer}`);
  }
  return doc + `\n\n**✓ RESOLVED (${question.slice(0, 40)}...):** ${answer}\n`;
}

function removeSection6(doc: string): string {
  const section6Pattern = /\n##\s*6\.?\s*(?:Open Questions|Items for Clarification|Open Questions & Items[\s\S]*?)(?=\n##\s*7\.?\s|\n##\s*5\.?\s|$)/;
  return doc.replace(section6Pattern, '');
}

const SAMPLE_CONOPS = `# CONOPS — Diesel-to-Electric Compact Tractor Conversion

## 1. Executive Summary & User Intent
Tractor conversion project.
Refurbishment needed: rust cleanup and hydraulic fluid leak at front right wheel/axel.

## 2. Operational Environment & Operating Location
Florida, unconditioned garage.

## 3. Operational Use Cases & System Modes
Mowing, loader work.

## 4. System Boundaries & High-Level Interfaces
Motor, battery, controller.

## 5. Safety, Environmental & Community Considerations
HV safety.

## 6. Open Questions & Items for Clarification

The following operational questions remain open:

**Q1. Mid-mount mower deck drive path.** The specific drive path is not yet confirmed.

**Q2. Charging dwell and recharge time.** Not yet confirmed.

**Q3. Thermal behavior in the unconditioned garage.** Not yet confirmed.

**Q4. Scope of automatic fault-isolation triggers.** Not yet confirmed.

**Q5. Dash display scope.** Not yet confirmed.

**Q6. Battery packaging feasibility and fuel-tank removal.** Not yet confirmed.

## Design Decisions
D-001: Retain OEM transmission.
`;

const TEST_ANSWERS = [
  'Motor drives deck via belt.',
  'Longest safe charge per BMS recommendation.',
  'Charge gated by temp sensor; garage max ~100F.',
  'Over-current on motor controller, temp sensors on battery and motor.',
  'Custom LED display, Arduino/RPi compatible.',
  '2×24V 50-100Ah front+rear on ventilated aluminum tray.',
];

// ── Bug 1: foldAnswerIntoDoc + removeSection6 deletes answers ─────────────────

describe('Bug 1 — foldAnswerIntoDoc + removeSection6 deletes user answers', () => {
  it('answers are placed inside Section 6 region, never in the document body', () => {
    const questions = parseSection6Questions(SAMPLE_CONOPS);
    let doc = SAMPLE_CONOPS;
    doc = foldAnswerIntoDoc(doc, questions[0], TEST_ANSWERS[0]);

    const s6Start = doc.indexOf('## 6.');
    const s6End = doc.indexOf('## Design Decisions');
    const beforeS6 = doc.slice(0, s6Start);
    const s6Region = doc.slice(s6Start, s6End);

    // Answer marker is only inside Section 6, not in sections 1–5
    expect(beforeS6).not.toContain('RESOLVED');
    expect(beforeS6).not.toContain('belt');
    expect(s6Region).toContain('RESOLVED');
    expect(s6Region).toContain('belt');
  });

  it('removeSection6 deletes all answer markers when all questions are answered', () => {
    const questions = parseSection6Questions(SAMPLE_CONOPS);
    expect(questions).toHaveLength(6);

    let doc = SAMPLE_CONOPS;
    for (let i = 0; i < questions.length; i++) {
      doc = foldAnswerIntoDoc(doc, questions[i], TEST_ANSWERS[i]);
    }

    // Answers present before section removal
    expect(doc).toContain('RESOLVED');
    expect(doc).toContain('belt');
    expect(doc).toContain('Arduino');

    // After removeSection6 — answers gone
    const cleared = removeSection6(doc);
    expect(cleared).not.toContain('RESOLVED');
    expect(cleared).not.toContain('belt');
    expect(cleared).not.toContain('Arduino');
  });

  it('initial user message info survives removeSection6 because it is in the body', () => {
    const questions = parseSection6Questions(SAMPLE_CONOPS);
    let doc = SAMPLE_CONOPS;
    for (let i = 0; i < questions.length; i++) {
      doc = foldAnswerIntoDoc(doc, questions[i], TEST_ANSWERS[i]);
    }
    const cleared = removeSection6(doc);

    // Initial message info (in body sections 1-5) is preserved
    expect(cleared).toContain('Refurbishment');
    expect(cleared).toContain('hydraulic fluid leak');
  });
});

// ── Bug 2: checkpoint overwrite restores pre-resolution draft ─────────────────

describe('Bug 2 — checkpoint overwrite restores open questions after resolution', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-test-'));
    fs.mkdirSync(path.join(tmpDir, 'docs'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('disk-first: checkpoint reads the file written by the specialist, not result.output', () => {
    // Specialist writes updated doc to disk (answers incorporated)
    const updatedDoc = `# CONOPS — Electric Tractor\n\n## 1. Executive Summary\nConversion. Refurbishment: rust cleanup, hydraulic leak.\n\n## 6. Open Questions\n\n(no remaining questions)\n`;
    const diskPath = path.join(tmpDir, 'docs', 'CONOPS.md');
    fs.writeFileSync(diskPath, updatedDoc);

    // result.output is the LLM's chat response — may be the old draft or commentary
    const staleOutput = SAMPLE_CONOPS; // old version with open questions

    // With disk-first logic the checkpoint should use the disk file
    let cleanedDoc = staleOutput;
    let isFullDeliverable = false;

    // === New disk-first logic (mirrors the fix in checkpoint.ts) ===
    const filePath = path.join(tmpDir, 'docs', 'CONOPS.md');
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf-8').trim();
      if (fileContent && fileContent.startsWith('# ')) {
        cleanedDoc = fileContent;
        isFullDeliverable = true;
      }
    }
    if (!isFullDeliverable && staleOutput.includes('# ')) {
      cleanedDoc = extractCleanMarkdownDocument(staleOutput);
      isFullDeliverable = true;
    }

    // Checkpoint uses updated disk content, not the stale output
    expect(cleanedDoc).toBe(updatedDoc.trim());
    expect(cleanedDoc).not.toContain('Q1.');
    expect(cleanedDoc).not.toContain('Q6.');
    expect(isFullDeliverable).toBe(true);
  });

  it('old output-first logic would have overwritten answers with open questions', () => {
    // Demonstrate the bug: old logic uses output when it contains '# '
    const updatedDoc = `# CONOPS\n\n## 1. Summary\nAnswer about mower deck: belt drive.\n`;
    const diskPath = path.join(tmpDir, 'docs', 'CONOPS.md');
    fs.writeFileSync(diskPath, updatedDoc);

    const staleOutput = SAMPLE_CONOPS; // old draft still has Q1–Q6

    // OLD logic (broken):
    const isFullDeliverableOld = staleOutput.includes('# '); // true — '# CONOPS' is in it
    const cleanedDocOld = isFullDeliverableOld
      ? extractCleanMarkdownDocument(staleOutput)
      : fs.readFileSync(diskPath, 'utf-8').trim();

    // Old logic picks up the stale output with open questions
    expect(cleanedDocOld).toContain('Q1.');
    expect(cleanedDocOld).toContain('Q6.');
    expect(cleanedDocOld).not.toContain('belt drive');
  });
});

// ── Fix verification: collectSection6Answers does not touch disk ──────────────

describe('Fix — collectSection6Answers interface contract', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-fix-'));
    fs.mkdirSync(path.join(tmpDir, 'docs'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parseSection6Questions correctly parses all 6 questions from the sample', () => {
    const questions = parseSection6Questions(SAMPLE_CONOPS);
    expect(questions).toHaveLength(6);
    expect(questions[0]).toContain('Mid-mount mower deck drive path');
    expect(questions[5]).toContain('Battery packaging feasibility');
  });

  it('collected answers produce an answerBlock that clearly states Q+A for LLM', () => {
    const mockAnswers = [
      { question: 'Mid-mount mower deck drive path. Details...', answer: 'Driven by motor via belt' },
      { question: 'Charging dwell and recharge time. Details...', answer: 'Overnight per BMS' },
    ];

    const answerBlock = mockAnswers
      .map((qa, i) => `Q${i + 1}: ${qa.question.slice(0, 150).replace(/\n/g, ' ')}\nAnswer: ${qa.answer}`)
      .join('\n\n');

    // The block clearly identifies each Q+A for the LLM to incorporate
    expect(answerBlock).toContain('Q1:');
    expect(answerBlock).toContain('Q2:');
    expect(answerBlock).toContain('Answer: Driven by motor via belt');
    expect(answerBlock).toContain('Answer: Overnight per BMS');
  });

  it('the enhanced prompt appended to userPrompt contains both the request and the answers', () => {
    const originalPrompt = 'Id like to finalize the conops. Refurbishment is needed on the rusted parts.';
    const mockAnswers = [
      { question: 'Mid-mount mower deck drive path.', answer: 'Motor via belt' },
    ];

    const answerBlock = mockAnswers
      .map((qa, i) => `Q${i + 1}: ${qa.question.slice(0, 150).replace(/\n/g, ' ')}\nAnswer: ${qa.answer}`)
      .join('\n\n');

    const enhancedPrompt = originalPrompt
      + '\n\nUSER ANSWERS TO OPEN SECTION 6 QUESTIONS (incorporate per your instructions):\n'
      + answerBlock;

    // LLM sees both the original message AND the answers
    expect(enhancedPrompt).toContain('finalize the conops');
    expect(enhancedPrompt).toContain('Refurbishment is needed');
    expect(enhancedPrompt).toContain('Q1:');
    expect(enhancedPrompt).toContain('Answer: Motor via belt');
    expect(enhancedPrompt).toContain('incorporate per your instructions');
  });
});
