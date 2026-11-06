/**
 * Thread-aware incorporation: the advisory conversation attached to a
 * question must reach the specialist that rewrites the document — and must
 * NEVER reach the document's pending block (the UNDO byte contract).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectStateManager } from '../src/workspace/state.js';
import type { PortalThreadMessage } from '../src/workspace/types.js';
import {
  buildIncorporationPrompt,
  collectThreadContext,
  THREAD_CONTEXT_CHAR_CAP,
  THREAD_CONTEXT_FRAMING,
  PENDING_INCORPORATION_MARKER
} from '../src/core/incorporation-prompt.js';

/** Today's exact prompt for phase 'rtm' — the byte contract for the no-context case. */
const TODAYS_RTM_PROMPT = `USER ANSWERS PENDING INCORPORATION detected in docs/RTM.md.

User answers below are pending incorporation: revise the document's normative text to incorporate them per your answer-handling instructions, then REMOVE the '## User Answers (Pending Incorporation)' block once incorporated.

You MUST write the complete updated document to docs/RTM.md using fs_write (or apply the edits with fs_edit). Your response must be the complete document content starting with a heading.`;

let tmpDir: string;
let stateManager: ProjectStateManager;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-thread-ctx-'));
  stateManager = new ProjectStateManager(tmpDir);
  stateManager.getOrCreateState('p1', 'Thread ctx project');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Appends one portal item carrying a thread (and optional extra meta) to state. */
function addThreadItem(
  docPath: string,
  thread: PortalThreadMessage[],
  extraMeta: Record<string, unknown> = {},
  status: 'open' | 'answered' = 'open'
): void {
  const state = stateManager.getState();
  state.portalItems!.push({
    id: `item-${docPath}-${state.portalItems!.length}`,
    type: 'question',
    severity: 'normal',
    docPath,
    title: `Question for ${docPath}`,
    status,
    source: 'autopilot',
    createdAt: '2026-11-03T00:00:00.000Z',
    updatedAt: '2026-11-03T00:00:00.000Z',
    meta: { thread, ...extraMeta }
  });
  stateManager.saveState(state);
}

function row(role: 'user' | 'specialist', text: string, ts: number, extra: Partial<PortalThreadMessage> = {}): PortalThreadMessage {
  return { role, text, ts, ...extra };
}

describe('buildIncorporationPrompt — advisory conversation block', () => {
  it('is byte-identical to today when no thread context is supplied', () => {
    expect(buildIncorporationPrompt('rtm')).toBe(TODAYS_RTM_PROMPT);
    expect(buildIncorporationPrompt('rtm', undefined)).toBe(TODAYS_RTM_PROMPT);
    expect(buildIncorporationPrompt('rtm', '')).toBe(TODAYS_RTM_PROMPT);
  });

  it('appends the advisory block with ctx verbatim plus the framing line', () => {
    const ctx = 'USER: should I add selectivity?\nSPECIALIST: Yes — 90% selectivity fits.';
    const prompt = buildIncorporationPrompt('rtm', ctx);
    expect(prompt.startsWith(TODAYS_RTM_PROMPT)).toBe(true);
    expect(prompt).toContain('## Advisory conversation with the user');
    expect(prompt).toContain(THREAD_CONTEXT_FRAMING);
    expect(prompt).toContain(ctx);
    // The advisory block must sit AFTER the explicit-answers instructions.
    expect(prompt.indexOf('## Advisory conversation with the user')).toBeGreaterThan(
      prompt.indexOf('REMOVE the')
    );
  });
});

describe('collectThreadContext', () => {
  it('returns undefined when no item for docs/RTM.md carries a thread', () => {
    addThreadItem('docs/CONOPS.md', [row('user', 'unrelated doc chat', 1)]);
    expect(collectThreadContext(stateManager, 'rtm')).toBeUndefined();

    const state = stateManager.getState();
    state.portalItems!.push({
      id: 'no-thread',
      type: 'question',
      severity: 'normal',
      docPath: 'docs/RTM.md',
      title: 'No thread here',
      status: 'open',
      source: 'autopilot',
      createdAt: '2026-11-03T00:00:00.000Z',
      updatedAt: '2026-11-03T00:00:00.000Z',
      meta: {}
    });
    stateManager.saveState(state);
    expect(collectThreadContext(stateManager, 'rtm')).toBeUndefined();
  });

  it('includes only the last 8 rows, user text full, specialist replies truncated with an ellipsis', () => {
    const longReply = 'R'.repeat(900);
    const thread: PortalThreadMessage[] = [];
    for (let i = 0; i < 10; i++) {
      thread.push(row('user', `question number ${i}`, i * 2 + 1));
      thread.push(row('specialist', i === 9 ? longReply : `reply number ${i}`, i * 2 + 2));
    }
    addThreadItem('docs/RTM.md', thread);

    const ctx = collectThreadContext(stateManager, 'rtm');
    expect(ctx).toBeDefined();
    // 10 rows dropped from the oldest end (20 rows total, keep 8).
    expect(ctx).not.toContain('question number 0');
    expect(ctx).not.toContain('question number 5');
    expect(ctx).toContain('question number 6');
    expect(ctx).toContain('question number 9');
    // User text is not truncated.
    const longUser = 'U'.repeat(700);
    addThreadItem('docs/RTM.md', [row('user', longUser, 100)]);
    const ctx2 = collectThreadContext(stateManager, 'rtm');
    expect(ctx2).toContain(longUser);
    // Specialist reply is truncated to ~400 chars plus an ellipsis marker.
    expect(ctx).toContain('R'.repeat(400));
    expect(ctx).not.toContain('R'.repeat(401));
    expect(ctx).toMatch(/…/);
  });

  it('keeps the whole block within THREAD_CONTEXT_CHAR_CAP by dropping whole rows from the oldest end', () => {
    const thread: PortalThreadMessage[] = [];
    for (let i = 0; i < 8; i++) {
      thread.push(row('user', `marker-${i} ` + 'x'.repeat(900), i * 2 + 1));
    }
    addThreadItem('docs/RTM.md', thread);

    const ctx = collectThreadContext(stateManager, 'rtm');
    expect(ctx).toBeDefined();
    const fullBlock = `## Advisory conversation with the user\n\n${THREAD_CONTEXT_FRAMING}\n\n${ctx}`;
    expect(fullBlock.length).toBeLessThanOrEqual(THREAD_CONTEXT_CHAR_CAP);
    // Newest rows survive, oldest are dropped whole (no partial rows).
    expect(ctx).toContain('marker-7');
    expect(ctx).not.toContain('marker-0');
    for (const line of (ctx as string).split('\n').filter(l => l.trim().length > 0)) {
      // Every rendered line is a complete row: 400+ chars of padding, never cut.
      expect(line).toContain('x'.repeat(900));
    }
  });

  it('labels recorded answers and proposals so a draft cannot be read as a decision', () => {
    addThreadItem('docs/RTM.md', [
      row('user', 'settle it', 1, { intent: 'answer', kind: 'recorded' }),
      row('specialist', 'draft verdict', 2, {
        kind: 'proposal',
        proposal: { status: 'pending', basedOn: 1 }
      }),
      row('specialist', 'plain advisory reply', 3)
    ]);
    const ctx = collectThreadContext(stateManager, 'rtm') as string;
    expect(ctx).toContain('ANSWER (recorded): settle it');
    expect(ctx).toContain('PROPOSAL (not recorded): draft verdict');
    expect(ctx).toContain('SPECIALIST: plain advisory reply');
  });

  it('does not re-inject a thread already consumed for this phase, and stamps consumed items', () => {
    addThreadItem('docs/RTM.md', [row('user', 'first pass', 10), row('specialist', 'ok', 11)]);
    const first = collectThreadContext(stateManager, 'rtm');
    expect(first).toContain('first pass');
    // Injected items carry the watermark.
    const stamped = stateManager.getState().portalItems!.find(i => i.docPath === 'docs/RTM.md')!;
    expect(stamped.meta?.threadConsumedBy).toBe('rtm:11');
    // Second call for the same phase injects nothing.
    expect(collectThreadContext(stateManager, 'rtm')).toBeUndefined();
  });

  it('never includes items for a different docPath', () => {
    addThreadItem('docs/RTM.md', [row('user', 'rtm talk', 1)]);
    addThreadItem('docs/BOM.md', [row('user', 'bom talk', 2)]);
    const ctx = collectThreadContext(stateManager, 'rtm') as string;
    expect(ctx).toContain('rtm talk');
    expect(ctx).not.toContain('bom talk');
  });

  it('never writes thread text into the document pending block (UNDO byte contract)', () => {
    const appendedText = `\n\n${PENDING_INCORPORATION_MARKER}\n\n**Should I add selectivity?**\nAnswer: Yes, 90%.\n`;
    const docPath = path.join(tmpDir, 'docs', 'RTM.md');
    fs.mkdirSync(path.dirname(docPath), { recursive: true });
    const docBytes = '# RTM\n\nBody.' + appendedText;
    fs.writeFileSync(docPath, docBytes, 'utf-8');

    addThreadItem('docs/RTM.md', [row('user', 'chat-only reasoning', 5)], {
      autoApplied: { answer: 'Yes, 90%.', appendedText, confidence: 0.9, sources: [], rationale: 'r' }
    });

    const ctx = collectThreadContext(stateManager, 'rtm');
    expect(ctx).toContain('chat-only reasoning');
    // Doc bytes untouched, appendedText untouched.
    expect(fs.readFileSync(docPath, 'utf-8')).toBe(docBytes);
    const item = stateManager.getState().portalItems![0];
    expect((item.meta?.autoApplied as { appendedText?: string }).appendedText).toBe(appendedText);
  });
});
