import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager } from '../src/workspace/state.js';
import {
  addPortalItem,
  answerPortalItem,
  dismissPortalItem,
  listPortalItems,
  clearResolvedThread,
  dedupeOpenPortalItems,
  archiveDuplicateOpenPortalItems
} from '../src/core/question-portal.js';
import { PortalItem } from '../src/workspace/types.js';

describe('question portal store', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'starn-question-portal-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('test', 'Test');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('add → list round-trip; id/createdAt/status set; persisted across manager reload', () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What max voltage?',
      detail: 'Battery pack nominal',
      gaps: ['voltage spec'],
      threadId: 'th-1',
      source: 'autopilot'
    });

    expect(item.id).toMatch(/^p_./);
    expect(item.createdAt).toBeTruthy();
    expect(item.updatedAt).toBe(item.createdAt);
    expect(item.status).toBe('open');

    const listed = listPortalItems(stateMgr);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What max voltage?',
      detail: 'Battery pack nominal',
      gaps: ['voltage spec'],
      threadId: 'th-1',
      source: 'autopilot',
      status: 'open'
    });

    // Re-load a fresh manager over the same dir — the item must still be there.
    const reloaded = new ProjectStateManager(tmpDir).getState();
    expect(reloaded.portalItems).toHaveLength(1);
    expect(reloaded.portalItems![0].id).toBe(item.id);
  });

  it('dedupes same docPath+title while autopilot is running', () => {
    const state = stateMgr.getState();
    state.autopilot!.running = true;
    stateMgr.saveState(state);

    const first = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'blocking',
      docPath: 'docs/CONOPS.md',
      title: 'Same question',
      source: 'autopilot'
    });
    const second = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'blocking',
      docPath: 'docs/CONOPS.md',
      title: 'Same question',
      source: 'autopilot'
    });

    expect(second.id).toBe(first.id);
    expect(listPortalItems(stateMgr)).toHaveLength(1);
  });

  it('same title but DIFFERENT docPath creates two distinct items even while running', () => {
    const state = stateMgr.getState();
    state.autopilot!.running = true;
    stateMgr.saveState(state);

    const inConops = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Same title',
      source: 'autopilot'
    });
    const inArch = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/ARCHITECTURE.md',
      title: 'Same title',
      source: 'autopilot'
    });

    expect(inArch.id).not.toBe(inConops.id);
    expect(listPortalItems(stateMgr)).toHaveLength(2);
  });

  it('answerPortalItem sets answer + status answered + bumps updatedAt', () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Voltage?',
      source: 'autopilot'
    });

    // Push updatedAt into the past so the bump is deterministic.
    const state = stateMgr.getState();
    const saved = state.portalItems!.find(i => i.id === item.id)!;
    saved.updatedAt = '2000-01-01T00:00:00.000Z';
    stateMgr.saveState(state);

    const answered = answerPortalItem(stateMgr, item.id, '42V nominal');
    expect(answered.status).toBe('answered');
    expect(answered.answer).toBe('42V nominal');
    expect(answered.updatedAt > saved.updatedAt).toBe(true);
  });

  it('answerPortalItem appends meta.answerHistory entries per applied answer (board #52)', () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Voltage?',
      source: 'autopilot'
    });

    answerPortalItem(stateMgr, item.id, 'first answer');
    answerPortalItem(stateMgr, item.id, 'second answer');

    const stored = stateMgr.getState().portalItems!.find(i => i.id === item.id)!;
    const history = stored.meta?.answerHistory as Array<{ text: string; at: string }>;
    expect(Array.isArray(history)).toBe(true);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ text: 'first answer' });
    expect(history[1]).toMatchObject({ text: 'second answer' });
    expect(typeof history[0].at).toBe('string');
  });

  it('caps meta.answerHistory at the last 20 entries when appending (board #52)', () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Voltage?',
      source: 'autopilot'
    });

    // Seed 20 prior history entries directly into the store.
    const state = stateMgr.getState();
    const stored = state.portalItems!.find(i => i.id === item.id)!;
    stored.meta = {
      answerHistory: Array.from({ length: 20 }, (_, i) => ({
        text: `answer ${i + 1}`,
        at: `2025-01-01T00:00:${String(i).padStart(2, '0')}.000Z`
      }))
    };
    stateMgr.saveState(state);

    answerPortalItem(stateMgr, item.id, 'answer 21');
    answerPortalItem(stateMgr, item.id, 'answer 22');

    const after = stateMgr.getState().portalItems!.find(i => i.id === item.id)!;
    const history = after.meta!.answerHistory!;
    expect(history).toHaveLength(20);
    // Oldest entries evicted, newest kept last.
    expect(history[0]).toMatchObject({ text: 'answer 3' });
    expect(history[19]).toMatchObject({ text: 'answer 22' });
  });

  it('dismissPortalItem sets status dismissed and bumps updatedAt', () => {
    const item = addPortalItem(stateMgr, {
      type: 'flag',
      severity: 'blocking',
      docPath: 'docs/ICD.md',
      title: 'Connector mismatch',
      source: 'shop-floor'
    });

    const state = stateMgr.getState();
    state.portalItems!.find(i => i.id === item.id)!.updatedAt = '2000-01-01T00:00:00.000Z';
    stateMgr.saveState(state);

    const dismissed = dismissPortalItem(stateMgr, item.id);
    expect(dismissed.id).toBe(item.id);
    expect(dismissed.status).toBe('dismissed');
    expect(dismissed.updatedAt > '2000-01-01T00:00:00.000Z').toBe(true);
  });

  it('listPortalItems filters by status/type and sorts open first, then createdAt desc', () => {
    const a1 = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Question one',
      source: 'autopilot'
    });
    const a2 = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Question two',
      source: 'autopilot'
    });
    const flag = addPortalItem(stateMgr, {
      type: 'flag',
      severity: 'blocking',
      docPath: 'docs/ICD.md',
      title: 'Flag one',
      source: 'shop-floor'
    });
    answerPortalItem(stateMgr, a2.id, 'answered reply');

    // Deterministic createdAt ordering: a1 oldest, flag newest.
    const state = stateMgr.getState();
    const setCreatedAt = (id: string, at: string) => {
      state.portalItems!.find(i => i.id === id)!.createdAt = at;
    };
    setCreatedAt(a1.id, '2024-01-01T00:00:00.000Z');
    setCreatedAt(a2.id, '2024-01-02T00:00:00.000Z');
    setCreatedAt(flag.id, '2024-01-03T00:00:00.000Z');
    stateMgr.saveState(state);

    // Both questions: a1 open (oldest) outranks a2 answered (newer) — status
    // rank wins over createdAt.
    const questions = listPortalItems(stateMgr, { type: 'question' });
    expect(questions.map(q => q.id)).toEqual([a1.id, a2.id]);

    // Within open status: newest createdAt first.
    const open = listPortalItems(stateMgr, { status: 'open' });
    expect(open.map(q => q.id)).toEqual([flag.id, a1.id]);

    expect(listPortalItems(stateMgr, { type: 'flag' })).toHaveLength(1);
    expect(listPortalItems(stateMgr, { status: 'answered' })).toHaveLength(1);
    expect(listPortalItems(stateMgr, { status: 'open', type: 'flag' })).toHaveLength(1);
    expect(listPortalItems(stateMgr, { status: 'answered', type: 'flag' })).toHaveLength(0);
  });

  it('listPortalItems filters by phaseId against the docPath prefix (case-insensitive)', () => {
    addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'In conops',
      source: 'autopilot'
    });
    addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/architecture.md',
      title: 'In arch lower',
      source: 'autopilot'
    });
    addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/ARCHITECTURE.md',
      title: 'In arch upper',
      source: 'autopilot'
    });

    expect(listPortalItems(stateMgr, { phaseId: 'conops' })).toHaveLength(1);
    expect(listPortalItems(stateMgr, { phaseId: 'architecture' })).toHaveLength(2);
    // Bucket paths (docs/ARCHITECTURE/sub.md) are not matched by the phase prefix.
    addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/architecture/notes.md',
      title: 'Nested',
      source: 'autopilot'
    });
    expect(listPortalItems(stateMgr, { phaseId: 'architecture' })).toHaveLength(2);
  });

  it('migrates a state.json without portalItems/autopilot: getState fills defaults, saveState persists them', () => {
    const statePath = path.join(tmpDir, '.starn', 'state.json');
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
    delete raw.portalItems;
    delete raw.autopilot;
    fs.writeFileSync(statePath, JSON.stringify(raw, null, 2), 'utf-8');

    const state = stateMgr.getState();
    expect(state.portalItems).toEqual([]);
    expect(state.autopilot).toEqual({
      running: false,
      docStatus: {},
      revisionsUsed: {},
      blocks: 0
    });

    // saveState persists the migrated defaults back to disk.
    stateMgr.saveState(state);
    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
    expect(persisted.portalItems).toEqual([]);
    expect(persisted.autopilot).toEqual({
      running: false,
      docStatus: {},
      revisionsUsed: {},
      blocks: 0
    });
  });

  it('getOrCreateState upgrades and persists the portal migration on existing state.json', () => {
    const statePath = path.join(tmpDir, '.starn', 'state.json');
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
    delete raw.portalItems;
    delete raw.autopilot;
    fs.writeFileSync(statePath, JSON.stringify(raw, null, 2), 'utf-8');

    stateMgr.getOrCreateState('test', 'Test');

    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
    expect(persisted.portalItems).toEqual([]);
    expect(persisted.autopilot).toEqual({
      running: false,
      docStatus: {},
      revisionsUsed: {},
      blocks: 0
    });
  });

  it('clearResolvedThread marks all open items of the thread resolved, leaves other states', () => {
    const open1 = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      threadId: 'th-7',
      title: 'Thread open 1',
      source: 'autopilot'
    });
    const open2 = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      threadId: 'th-7',
      title: 'Thread open 2',
      source: 'autopilot'
    });
    const answered = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      threadId: 'th-7',
      title: 'Thread answered',
      source: 'autopilot'
    });
    answerPortalItem(stateMgr, answered.id, 'done');
    const otherThread = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      threadId: 'th-8',
      title: 'Other thread',
      source: 'autopilot'
    });

    clearResolvedThread(stateMgr, 'th-7');

    const byId = new Map(listPortalItems(stateMgr).map(i => [i.id, i]));
    expect(byId.get(open1.id)!.status).toBe('resolved');
    expect(byId.get(open2.id)!.status).toBe('resolved');
    expect(byId.get(answered.id)!.status).toBe('answered');
    expect(byId.get(otherThread.id)!.status).toBe('open');
  });

  it('caps the store at 500 items: archives the oldest open item instead of pushing beyond', () => {
    const brandNew = Date.UTC(2024, 0, 1, 0, 0, 0);
    const items: PortalItem[] = Array.from({ length: 500 }, (_, i) => ({
      id: `pre_${i}`,
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: `Question ${i}`,
      status: 'open',
      source: 'autopilot',
      createdAt: new Date(brandNew + i * 1000).toISOString(),
      updatedAt: new Date(brandNew + i * 1000).toISOString()
    }));
    const state = stateMgr.getState();
    state.portalItems = items;
    stateMgr.saveState(state);

    addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/ICD.md',
      title: 'Question 500',
      source: 'autopilot'
    });

    const after = stateMgr.getState();
    expect(after.portalItems!.length).toBeLessThanOrEqual(500);

    const archived = after.portalItems!.filter(i => i.meta?.archived === true);
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe('pre_0');
    expect(archived[0].status).toBe('open');
  });

  describe('cross-run dedupe', () => {
    const base = {
      type: 'question' as const,
      severity: 'normal' as const,
      docPath: 'docs/CONOPS.md',
      title: 'What max voltage?',
      source: 'autopilot' as const
    };

    function makeItem(over: Partial<PortalItem>): PortalItem {
      return {
        id: 'x',
        type: 'question',
        severity: 'normal',
        docPath: 'docs/CONOPS.md',
        title: 'What max voltage?',
        status: 'open',
        source: 'autopilot',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        ...over
      };
    }

    it('dedupes an identical open question even when autopilot is NOT running', () => {
      expect(stateMgr.getState().autopilot!.running).toBe(false);
      const first = addPortalItem(stateMgr, base);
      const second = addPortalItem(stateMgr, base);
      expect(second.id).toBe(first.id);
      expect(listPortalItems(stateMgr)).toHaveLength(1);
    });

    it('dedupes titles that differ only by case and whitespace', () => {
      const first = addPortalItem(stateMgr, base);
      const second = addPortalItem(stateMgr, { ...base, title: '  what MAX   voltage? ' });
      expect(second.id).toBe(first.id);
    });

    it('does not dedupe across different docPath or type', () => {
      addPortalItem(stateMgr, base);
      addPortalItem(stateMgr, { ...base, docPath: 'docs/ICD.md' });
      addPortalItem(stateMgr, { ...base, type: 'flag' });
      expect(listPortalItems(stateMgr)).toHaveLength(3);
    });

    it('does not dedupe onto an answered item', () => {
      const first = addPortalItem(stateMgr, base);
      answerPortalItem(stateMgr, first.id, '42V');
      const second = addPortalItem(stateMgr, base);
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('open');
    });

    it('dedupeOpenPortalItems keeps the oldest and archives later open duplicates', () => {
      const items = [
        makeItem({ id: 'new', createdAt: '2025-01-03T00:00:00.000Z' }),
        makeItem({ id: 'old', createdAt: '2025-01-01T00:00:00.000Z' }),
        makeItem({ id: 'mid', createdAt: '2025-01-02T00:00:00.000Z', title: ' WHAT max voltage?' })
      ];
      const changed = dedupeOpenPortalItems(items);
      expect(changed).toBe(true);
      expect(items.find(i => i.id === 'old')!.meta?.archived).toBeUndefined();
      expect(items.find(i => i.id === 'mid')!.meta?.archived).toBe(true);
      expect(items.find(i => i.id === 'new')!.meta?.archived).toBe(true);
    });

    it('dedupeOpenPortalItems never touches answered/dismissed items or different docPath/type', () => {
      const items = [
        makeItem({ id: 'a', createdAt: '2025-01-01T00:00:00.000Z' }),
        makeItem({ id: 'answered', status: 'answered', createdAt: '2025-01-02T00:00:00.000Z' }),
        makeItem({ id: 'dismissed', status: 'dismissed', createdAt: '2025-01-02T00:00:00.000Z' }),
        makeItem({ id: 'other-doc', docPath: 'docs/ICD.md', createdAt: '2025-01-02T00:00:00.000Z' }),
        makeItem({ id: 'other-type', type: 'flag', createdAt: '2025-01-02T00:00:00.000Z' })
      ];
      expect(dedupeOpenPortalItems(items)).toBe(false);
      expect(items.every(i => i.meta?.archived === undefined)).toBe(true);
    });

    it('dedupeOpenPortalItems is idempotent', () => {
      const items = [
        makeItem({ id: 'old', createdAt: '2025-01-01T00:00:00.000Z' }),
        makeItem({ id: 'new', createdAt: '2025-01-03T00:00:00.000Z' })
      ];
      expect(dedupeOpenPortalItems(items)).toBe(true);
      expect(dedupeOpenPortalItems(items)).toBe(false);
      expect(items.filter(i => i.meta?.archived === true)).toHaveLength(1);
    });

    it('archiveDuplicateOpenPortalItems persists the heal; listPortalItems hides archived items', () => {
      const state = stateMgr.getState();
      state.portalItems = [
        makeItem({ id: 'old', createdAt: '2025-01-01T00:00:00.000Z' }),
        makeItem({ id: 'new', createdAt: '2025-01-03T00:00:00.000Z' })
      ];
      stateMgr.saveState(state);

      archiveDuplicateOpenPortalItems(stateMgr);

      const reloaded = new ProjectStateManager(tmpDir).getState();
      expect(reloaded.portalItems!.find(i => i.id === 'new')!.meta?.archived).toBe(true);
      expect(listPortalItems(stateMgr).map(i => i.id)).toEqual(['old']);
    });
  });
});
