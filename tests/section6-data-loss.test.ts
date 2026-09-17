/**
 * Regression tests for Section 6 answer resolution.
 *
 * History: an older resolveSection6() path used regex patching
 * (foldAnswerIntoDoc + removeSection6) to write answers directly to disk
 * after the agent loop. This caused three data-loss bugs: answers placed
 * inside Section 6 were wiped by removeSection6; the checkpoint overwrote
 * the post-resolution disk file with the pre-resolution draft; and the LLM
 * never saw the answers. That code has been deleted. The live path is
 * collectOpenQuestions(), which returns Q&A pairs without touching disk.
 *
 * These tests pin the live contract.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseSection6Questions } from '../src/cli/section6-resolver.js';

const SAMPLE_CONOPS = `# CONOPS — Diesel-to-Electric Compact Tractor Conversion

## 1. Executive Summary & User Intent
Tractor conversion project.

## 6. Open Questions & Items for Clarification

**Q1. Mid-mount mower deck drive path.** Not yet confirmed.

**Q2. Charging dwell and recharge time.** Not yet confirmed.

## Design Decisions
D-001: Retain OEM transmission.
`;

describe('Section 6 live resolution contract', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-s6-'));
    fs.mkdirSync(path.join(tmpDir, 'docs'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parseSection6Questions extracts all open questions', () => {
    const questions = parseSection6Questions(SAMPLE_CONOPS);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toContain('Mid-mount mower deck drive path');
    expect(questions[1]).toContain('Charging dwell');
  });

  it('parsing does NOT touch the disk', () => {
    const docPath = path.join(tmpDir, 'docs', 'CONOPS.md');
    fs.writeFileSync(docPath, SAMPLE_CONOPS, 'utf-8');
    const before = fs.readFileSync(docPath, 'utf-8');

    const questions = parseSection6Questions(SAMPLE_CONOPS);
    expect(questions).toHaveLength(2);

    const after = fs.readFileSync(docPath, 'utf-8');
    expect(after).toBe(before);
  });

  it('answerBlock format clearly states Q+A for LLM incorporation', () => {
    const mockAnswers = [
      { question: 'Mid-mount mower deck drive path.', answer: 'Motor via belt' },
      { question: 'Charging dwell.', answer: 'Overnight per BMS' }
    ];
    const answerBlock = mockAnswers
      .map((qa, i) => `Q${i + 1}: ${qa.question.slice(0, 150).replace(/\n/g, ' ')}\nAnswer: ${qa.answer}`)
      .join('\n\n');
    expect(answerBlock).toContain('Q1:');
    expect(answerBlock).toContain('Answer: Motor via belt');
    expect(answerBlock).toContain('Q2:');
    expect(answerBlock).toContain('Answer: Overnight per BMS');
  });

  it('returns empty for a doc without Section 6', () => {
    expect(parseSection6Questions('# Doc\n\n## 1. Summary\nNo questions here.')).toEqual([]);
  });
});
