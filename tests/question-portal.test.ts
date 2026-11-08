import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager } from '../src/workspace/state.js';
import {
  addPortalItem,
  addQuestionItemIfValid,
  answerPortalItem,
  dismissPortalItem,
  listPortalItems,
  clearResolvedThread,
  dedupeOpenPortalItems,
  archiveDuplicateOpenPortalItems,
  questionSimilarity,
  appendThreadMessage,
  THREAD_MESSAGE_CAP,
  SIMILARITY_THRESHOLD
} from '../src/core/question-portal.js';
import { PortalItem, PortalThreadMessage } from '../src/workspace/types.js';

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

  it('P2 cross-doc twin above threshold: tagged meta.upstreamOf, persisted for audit, hidden from default listing', () => {
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

    // Not merged: the twin is its own persisted item (audit trail) pointing at
    // the canonical (oldest) open item.
    expect(inArch.id).not.toBe(inConops.id);
    expect(inArch.meta?.upstreamOf).toBe(inConops.id);
    expect(inConops.meta?.upstreamOf).toBeUndefined();
    // Hidden from the default open listing; visible with includeUpstream.
    expect(listPortalItems(stateMgr).map(i => i.id)).toEqual([inConops.id]);
    expect(listPortalItems(stateMgr, { includeUpstream: true }).map(i => i.id))
      .toEqual([inArch.id, inConops.id]);
  });

  it('P2 cross-doc twin below threshold: two distinct open items, both visible', () => {
    const inConops = addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/CONOPS.md',
      title: 'What gauge wire?', source: 'autopilot'
    });
    const inArch = addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/ARCHITECTURE.md',
      title: 'What max voltage?', source: 'autopilot'
    });
    expect(inArch.meta?.upstreamOf).toBeUndefined();
    expect(listPortalItems(stateMgr).map(i => i.id)).toEqual([inArch.id, inConops.id]);
  });

  it('P2 topic veto: both tagged with DIFFERENT topics never merges, even at identical slugs', () => {
    addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/ICD.md',
      title: 'Same title', source: 'autopilot', meta: { topic: 'electrical' }
    });
    const other = addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/ARCHITECTURE.md',
      title: 'Same title', source: 'autopilot', meta: { topic: 'mechanical' }
    });
    expect(other.meta?.upstreamOf).toBeUndefined();
    expect(listPortalItems(stateMgr)).toHaveLength(2);
  });

  it('P2 topic veto: either topic undefined → merge allowed (tagged when similar)', () => {
    const canonical = addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/ICD.md',
      title: 'Same title', source: 'autopilot', meta: { topic: 'electrical' }
    });
    const child = addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/ARCHITECTURE.md',
      title: 'Same title', source: 'autopilot'
    });
    expect(child.meta?.upstreamOf).toBe(canonical.id);
  });

  it('P2 cascade: answering the canonical supersedes its open upstreamOf children (chains recurse)', () => {
    const canonical = addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?', source: 'autopilot'
    });
    const child = addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/RTM.md',
      title: 'What is the max voltage?', source: 'autopilot'
    });
    expect(child.meta?.upstreamOf).toBe(canonical.id);

    // Legacy chain data: a grandchild pointing at the child (pre-flat tagging).
    const state = stateMgr.getState();
    state.portalItems!.push({
      id: 'legacy_grandchild',
      type: 'question',
      severity: 'normal',
      docPath: 'docs/BOM.md',
      title: 'What is the max pack voltage?',
      status: 'open',
      source: 'autopilot',
      createdAt: '2024-12-01T00:00:00.000Z',
      updatedAt: '2024-12-01T00:00:00.000Z',
      meta: { upstreamOf: child.id }
    });
    stateMgr.saveState(state);

    answerPortalItem(stateMgr, canonical.id, '48V');

    const stored = stateMgr.getState().portalItems!;
    expect(stored.find(i => i.id === child.id)?.meta?.superseded).toBe(true);
    expect(stored.find(i => i.id === child.id)?.status).toBe('open');
    expect(stored.find(i => i.id === 'legacy_grandchild')?.meta?.superseded).toBe(true);
    // Hidden children are gone from the default listing (the answered
    // canonical itself is still listed — status answered, not hidden).
    expect(listPortalItems(stateMgr).map(i => i.id)).toEqual([canonical.id]);
    // The children are also superseded, so even includeUpstream (which lifts
    // ONLY the upstreamOf filter) reveals nothing extra here.
  });

  it('P2 questionSimilarity: pure token-Jaccard over questionSlug tokens; threshold exported', () => {
    expect(questionSimilarity('What is the max voltage?', 'Q1. What is the max voltage?')).toBe(1);
    expect(questionSimilarity('What gauge wire?', 'What is the max voltage?'))
      .toBeLessThan(SIMILARITY_THRESHOLD);
    // 3 shared of {same,doc,follow,up}+{unrelated,doc,follow,up} → 3/5 = 0.6.
    expect(questionSimilarity('Same doc follow up', 'Unrelated doc follow up')).toBeCloseTo(0.6);
    expect(questionSimilarity('', 'What voltage?')).toBe(0);
    expect(SIMILARITY_THRESHOLD).toBeGreaterThan(0.5);
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

  it('listPortalItems filters by meta.topic; untagged items are excluded by a topic filter (P5)', () => {
    const e = addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/ICD.md',
      title: 'Bus voltage', source: 'autopilot', meta: { topic: 'electrical' }
    });
    const m = addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/ICD.md',
      title: 'Bolt pattern', source: 'autopilot', meta: { topic: 'mechanical' }
    });
    addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/CONOPS.md',
      title: 'Pre-tag legacy question', source: 'autopilot'
    });

    const electrical = listPortalItems(stateMgr, { topic: 'electrical' });
    expect(electrical.map(i => i.id)).toEqual([e.id]);
    expect(listPortalItems(stateMgr, { topic: 'mechanical' }).map(i => i.id)).toEqual([m.id]);
    // No topic filter → everything (including untagged) is returned.
    expect(listPortalItems(stateMgr)).toHaveLength(3);
    // Unknown topics match nothing; empty string is treated as no filter.
    expect(listPortalItems(stateMgr, { topic: 'software' })).toHaveLength(0);
    expect(listPortalItems(stateMgr, { topic: '' })).toHaveLength(3);
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

    it('P2 re-scope: cross-doc same-slug twin is tagged (hidden), different type never merges', () => {
      const canonical = addPortalItem(stateMgr, base);
      const crossDoc = addPortalItem(stateMgr, { ...base, docPath: 'docs/ICD.md' });
      const flag = addPortalItem(stateMgr, { ...base, type: 'flag' });
      // Cross-doc twin: a SEPARATE persisted item tagged upstreamOf (not merged
      // onto the canonical); different type is never fuzzy-matched.
      expect(crossDoc.id).not.toBe(canonical.id);
      expect(crossDoc.meta?.upstreamOf).toBe(canonical.id);
      expect(flag.meta?.upstreamOf).toBeUndefined();
      const listed = listPortalItems(stateMgr);
      expect(listed).toHaveLength(2);
      expect(listed.map(i => i.id).sort()).toEqual([canonical.id, flag.id].sort());
    });

    it('does not dedupe onto an answered item', () => {
      const first = addPortalItem(stateMgr, base);
      answerPortalItem(stateMgr, first.id, '42V');
      const second = addPortalItem(stateMgr, base);
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('open');
    });

    it('dedupes wording variants via question slug (Qn prefix, punctuation, numbering drift)', () => {
      const first = addPortalItem(stateMgr, base);
      const second = addPortalItem(stateMgr, { ...base, title: 'Q3. What max voltage?' });
      expect(second.id).toBe(first.id);
      expect(listPortalItems(stateMgr)).toHaveLength(1);
    });

    it('dedupeOpenPortalItems is idempotent', () => {
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

    it('answerPortalItem supersedes open twins with the same slug (stable identity)', () => {
    const original = addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/CONOPS.md',
      title: 'Q1. What gauge wire?', source: 'autopilot'
    });
    const other = addPortalItem(stateMgr, {
      type: 'question', severity: 'normal', docPath: 'docs/CONOPS.md',
      title: 'What fuse rating?', source: 'autopilot'
    });

    // Legacy twin: same doc, wording variant, stored directly (pre-slug data).
    const state = stateMgr.getState();
    state.portalItems!.push({
      id: 'legacy_twin',
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Q2. What gauge wire?',
      status: 'open',
      source: 'autopilot',
      createdAt: '2024-12-01T00:00:00.000Z',
      updatedAt: '2024-12-01T00:00:00.000Z'
    });
    stateMgr.saveState(state);

    answerPortalItem(stateMgr, original.id, '10 AWG');

    const stored = stateMgr.getState().portalItems!;
    expect(stored.find(i => i.id === 'legacy_twin')?.meta?.superseded).toBe(true);
    expect(stored.find(i => i.id === other.id)?.status).toBe('open');
    expect(stored.find(i => i.id === other.id)?.meta?.superseded).toBeUndefined();
    // superseded twin is hidden from the list
    expect(listPortalItems(stateMgr).find(i => i.id === 'legacy_twin')).toBeUndefined();
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

describe('addPortalItem — intake-path short-title rewrite (sections present)', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'starn-portal-rewrite-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('test', 'Test');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const SECTIONS = { bluf: '48V nominal.', suggestion: '48V battery.' };

  it('a question created WITH sections and a wall-of-text title is shortened at creation', () => {
    const longTitle = 'Q1. ' + 'B'.repeat(1180);
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: longTitle,
      source: 'autopilot',
      meta: { sections: SECTIONS }
    });
    expect(item.title).toBe('B'.repeat(57) + '…');
    expect(item.meta?.originalTitle).toBe(longTitle);
    expect(item.detail).toBe(longTitle); // detail mirror — no information loss
    expect(item.meta?.sections).toEqual(SECTIONS);
  });

  it('an existing detail is preserved; short titles with sections are left alone', () => {
    const withDetail = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Q1. ' + 'C'.repeat(300),
      detail: 'Battery pack nominal',
      source: 'autopilot',
      meta: { sections: SECTIONS }
    });
    expect(withDetail.detail).toBe('Battery pack nominal');
    expect(withDetail.meta?.originalTitle).toBe('Q1. ' + 'C'.repeat(300));

    const short = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Bus voltage?',
      source: 'autopilot',
      meta: { sections: SECTIONS }
    });
    expect(short.title).toBe('Bus voltage?');
    expect(short.meta?.originalTitle).toBeUndefined();
  });

  it('non-question types with meta are untouched; dedupe still keys on the original title', () => {
    const flag = addPortalItem(stateMgr, {
      type: 'gap' as any,
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'G'.repeat(300),
      source: 'autopilot',
      meta: { sections: SECTIONS } as any
    });
    expect(flag.title).toBe('G'.repeat(300));

    const longTitle = 'Q2. ' + 'D'.repeat(400);
    addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: longTitle,
      source: 'autopilot',
      meta: { sections: SECTIONS }
    });
    const twin = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: longTitle,
      source: 'autopilot',
      meta: { sections: SECTIONS }
    });
    // Same pre-rewrite title → the second add dedupes onto the first.
    expect(stateMgr.getState().portalItems!.filter(i => i.type === 'question')).toHaveLength(1);
    expect(twin.meta?.originalTitle).toBe(longTitle);
  });

  it('keys dedupe on the raw header: entries differing only after the "?" stay separate', () => {
    const shared = '[ELECTRICAL] Main bus voltage?';
    const rawA = shared + ' Because the load profile and the cranking spec disagree, we need a decision this week.';
    const rawB = shared + ' Because the supplier only lists 48 V today, we need a decision before ordering.';
    const first = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: shared,
      source: 'autopilot',
      meta: { originalTitle: rawA, sections: { background: 'load profile' } }
    });
    const second = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: shared,
      source: 'autopilot',
      meta: { originalTitle: rawB, sections: { background: 'supplier' } }
    });
    expect(second.id).not.toBe(first.id);
    expect(stateMgr.getState().portalItems!.filter(i => i.type === 'question')).toHaveLength(2);
  });

  it('a legacy item whose originalTitle is the untrimmed header matches the newly trimmed intake', () => {
    const raw = '[ELECTRICAL] Main bus voltage? Because the load profile and the cranking spec disagree, we need a decision this week.';
    const legacy = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: raw,
      source: 'autopilot',
      meta: { originalTitle: raw }
    });
    const fresh = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: '[ELECTRICAL] Main bus voltage?',
      source: 'autopilot',
      meta: { originalTitle: raw, sections: { background: 'load profile' } }
    });
    expect(fresh.id).toBe(legacy.id);
    expect(stateMgr.getState().portalItems!.filter(i => i.type === 'question')).toHaveLength(1);
  });

  it('addQuestionItemIfValid skips question items with an empty trimmed title (F3 bare-button guard)', () => {
    const result = addQuestionItemIfValid(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: '   ',
      source: 'autopilot'
    });
    expect(result).toBeUndefined();
    expect(stateMgr.getState().portalItems ?? []).toHaveLength(0);
  });

  it('addQuestionItemIfValid delegates to addPortalItem for a valid title and for non-question types', () => {
    const question = addQuestionItemIfValid(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Real question?',
      source: 'autopilot'
    });
    expect(question?.title).toBe('Real question?');
    const parked = addQuestionItemIfValid(stateMgr, {
      type: 'parked',
      severity: 'blocking',
      docPath: 'docs/CONOPS.md',
      title: '',
      source: 'autopilot'
    });
    expect(parked).toBeDefined();
    expect(stateMgr.getState().portalItems ?? []).toHaveLength(2);
  });
});

/** Pure thread-append + trim rule (Task 2). No filesystem, no state manager. */
describe('appendThreadMessage', () => {
  const row = (text: string, extra: Partial<PortalThreadMessage> = {}): PortalThreadMessage => ({
    role: 'user',
    text,
    ts: 0,
    ...extra
  });

  it('appends legacy rows (no intent/kind) and trims oldest-first exactly as before', () => {
    let thread: PortalThreadMessage[] = [];
    const appended: PortalThreadMessage[] = [];
    for (let i = 1; i <= THREAD_MESSAGE_CAP + 4; i++) {
      const next: PortalThreadMessage = { role: i % 2 === 1 ? 'user' : 'specialist', text: `m${i}`, ts: i };
      appended.push(next);
      thread = appendThreadMessage(thread, next);
      // Pre-Task-2 inline rule in session.ts: keep the first row plus the
      // most recent CAP-1 rows.
      const legacy = appended.length > THREAD_MESSAGE_CAP
        ? [appended[0], ...appended.slice(appended.length - THREAD_MESSAGE_CAP + 1)]
        : appended;
      expect(thread).toEqual(legacy);
    }
    expect(thread).toHaveLength(THREAD_MESSAGE_CAP);
    expect(thread[0].text).toBe('m1');
    expect(thread[thread.length - 1].text).toBe(`m${THREAD_MESSAGE_CAP + 4}`);
    // The trim rule never invents intent/kind on legacy rows.
    expect(thread.every(m => m.intent === undefined && m.kind === undefined)).toBe(true);
  });

  it('never drops recorded or proposal rows, even when they are the oldest', () => {
    const recorded = row('recorded answer', { intent: 'answer', kind: 'recorded', ts: 1 });
    const proposal = row('concluded draft', {
      role: 'specialist',
      kind: 'proposal',
      ts: 2,
      proposal: { status: 'superseded', basedOn: 1 }
    });
    let thread: PortalThreadMessage[] = [row('first', { ts: 0 }), recorded, proposal];
    for (let i = 0; i < THREAD_MESSAGE_CAP + 4; i++) {
      thread = appendThreadMessage(thread, row(`m${i}`, { ts: 10 + i }));
    }
    expect(thread).toHaveLength(THREAD_MESSAGE_CAP);
    expect(thread.filter(m => m.kind === 'recorded')).toEqual([recorded]);
    expect(thread.filter(m => m.kind === 'proposal')).toEqual([proposal]);
    // Permanent rows still OCCUPY rows: only CAP - 2 plain message rows fit.
    expect(thread.filter(m => m.kind === undefined)).toHaveLength(THREAD_MESSAGE_CAP - 2);
  });

  it('an all-permanent thread is never trimmed, so it may exceed the cap', () => {
    const permanent: PortalThreadMessage[] = [];
    for (let i = 0; i < THREAD_MESSAGE_CAP + 5; i++) {
      permanent.push(row(`r${i}`, { role: 'specialist', kind: 'recorded', ts: i }));
    }
    const result = appendThreadMessage(permanent, row('another record', { kind: 'recorded', ts: 99 }));
    // No message row to trim → nothing is dropped, even past the cap.
    expect(result).toHaveLength(THREAD_MESSAGE_CAP + 6);
    expect(result.every(m => m.kind === 'recorded')).toBe(true);
  });

  it('treats an undefined thread as empty (documented contract)', () => {
    const first = row('first', { ts: 1 });
    expect(appendThreadMessage(undefined, first)).toEqual([first]);
  });

  it('normalizes an already-over-cap legacy thread (30 rows → cap)', () => {
    const legacy: PortalThreadMessage[] = [];
    for (let i = 0; i < 30; i++) legacy.push(row(`m${i}`, { ts: i }));
    const result = appendThreadMessage(legacy, row('newest', { ts: 99 }));
    expect(result).toHaveLength(THREAD_MESSAGE_CAP);
    expect(result[0]).toEqual(legacy[0]);
    expect(result[result.length - 1].text).toBe('newest');
    // Newest CAP - 1 legacy rows survive, oldest dropped.
    expect(result[1].text).toBe('m12');
  });

  it('tolerates a null row in a hand-edited thread (no throw, row trimmed first)', () => {
    const thread = [row('first', { ts: 0 }), null as unknown as PortalThreadMessage];
    for (let i = 0; i < THREAD_MESSAGE_CAP; i++) {
      thread.push(row(`m${i}`, { ts: 10 + i }));
    }
    const result = appendThreadMessage(thread, row('newest', { ts: 99 }));
    expect(result).toHaveLength(THREAD_MESSAGE_CAP);
    expect(result[0].text).toBe('first');
    expect(result.every(m => m !== null)).toBe(true);
  });
});

describe('dedupeOpenPortalItems — open twins of an ALREADY-ANSWERED item (issue #144)', () => {
  function item(over: Partial<PortalItem>): PortalItem {
    return {
      id: 'x',
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What max voltage?',
      status: 'open',
      source: 'autopilot',
      createdAt: '2026-10-30T00:00:00.000Z',
      updatedAt: '2026-10-30T00:00:00.000Z',
      ...over
    };
  }

  it('archives an open twin created BEFORE the answered twin', () => {
    const openTwin = item({ id: 'open-twin', createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' });
    const answered = item({
      id: 'answered',
      status: 'answered',
      answer: '48V nominal',
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-11-07T00:00:00.000Z'
    });

    expect(dedupeOpenPortalItems([openTwin, answered])).toBe(true);
    expect(openTwin.meta?.archived).toBe(true);
    expect(answered.meta?.archived).toBeUndefined();
    expect(answered.status).toBe('answered');
  });

  it('does NOT archive an open item created AFTER the answer (genuine re-open)', () => {
    const answered = item({
      id: 'answered',
      status: 'answered',
      answer: '48V nominal',
      createdAt: '2026-10-30T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z'
    });
    const reopened = item({ id: 'reopened', createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' });

    expect(dedupeOpenPortalItems([answered, reopened])).toBe(false);
    expect(reopened.meta?.archived).toBeUndefined();
  });

  it('does NOT archive when the answered twin has an EMPTY answer', () => {
    const openTwin = item({ id: 'open-twin' });
    const answered = item({ id: 'answered', status: 'answered', answer: '   ', createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z' });

    expect(dedupeOpenPortalItems([openTwin, answered])).toBe(false);
    expect(openTwin.meta?.archived).toBeUndefined();
  });

  it('does NOT archive the same title in a DIFFERENT docPath (dedupeKey includes docPath)', () => {
    const openTwin = item({ id: 'open-twin', docPath: 'docs/ICD.md' });
    const answered = item({ id: 'answered', status: 'answered', answer: '48V nominal', docPath: 'docs/CONOPS.md', createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z' });

    expect(dedupeOpenPortalItems([openTwin, answered])).toBe(false);
    expect(openTwin.meta?.archived).toBeUndefined();
  });

  it('keeps the oldest open twin and archives the later one (open-vs-open pass unchanged)', () => {
    const old = item({ id: 'old', createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' });
    const newer = item({ id: 'newer', createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z' });

    expect(dedupeOpenPortalItems([newer, old])).toBe(true);
    expect(old.meta?.archived).toBeUndefined();
    expect(newer.meta?.archived).toBe(true);
  });

  it('3-item mix: one answered + two open twins → both twins archived, answered untouched', () => {
    const answered = item({
      id: 'answered',
      status: 'answered',
      answer: '48V nominal',
      createdAt: '2026-10-29T00:00:00.000Z',
      updatedAt: '2026-11-07T00:00:00.000Z'
    });
    const twinA = item({ id: 'twin-a', createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' });
    const twinB = item({ id: 'twin-b', createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z' });

    expect(dedupeOpenPortalItems([answered, twinA, twinB])).toBe(true);
    expect(twinA.meta?.archived).toBe(true);
    expect(twinB.meta?.archived).toBe(true);
    expect(answered.meta?.archived).toBeUndefined();
    expect(answered.answer).toBe('48V nominal');
    expect(dedupeOpenPortalItems([answered, twinA, twinB])).toBe(false);
  });
});
