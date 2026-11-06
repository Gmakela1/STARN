import { describe, it, expect } from 'vitest';
import type { PortalItem } from '../types/api';
import { QUESTION_TOPICS, cleanQuestionTitle, groupPortalItemsByTopic, itemTopic, topicLabel } from './portalGrouping';

function item(id: string, topic?: string, createdAt = '2026-01-01T00:00:00.000Z'): PortalItem {
  return {
    id,
    type: 'question',
    severity: 'normal',
    title: `Q — ${id}`,
    status: 'open',
    source: 'autopilot',
    createdAt,
    updatedAt: createdAt,
    ...(topic !== undefined ? { meta: { topic } } : {})
  };
}

describe('groupPortalItemsByTopic', () => {
  it('groups items in QUESTION_TOPICS order and skips empty groups', () => {
    const groups = groupPortalItemsByTopic([
      item('t', 'thermal'),
      item('e1', 'electrical'),
      item('e2', 'electrical')
    ]);
    expect(groups.map(g => g.topic)).toEqual(['electrical', 'thermal']);
    expect(groups[0].label).toBe('Electrical');
    expect(groups[0].items.map(i => i.id)).toEqual(['e1', 'e2']);
  });

  it('buckets undefined topics into a trailing "Other" group', () => {
    const groups = groupPortalItemsByTopic([item('a'), item('m', 'mechanical'), item('b')]);
    expect(groups.map(g => g.topic)).toEqual(['mechanical', 'other']);
    expect(groups[1].label).toBe('Other');
    expect(groups[1].items.map(i => i.id)).toEqual(['a', 'b']);
  });

  it('buckets unknown tags into "Other" (tolerant, not dropped)', () => {
    const groups = groupPortalItemsByTopic([item('x', 'software'), item('e', 'electrical')]);
    expect(groups.map(g => g.topic)).toEqual(['electrical', 'other']);
    expect(groups[1].items.map(i => i.id)).toEqual(['x']);
  });

  it('preserves the incoming (newest-first) order within each group', () => {
    const groups = groupPortalItemsByTopic([
      item('new', 'electrical', '2026-01-02T00:00:00.000Z'),
      item('old', 'electrical', '2026-01-01T00:00:00.000Z'),
      item('mid', undefined, '2026-01-01T12:00:00.000Z')
    ]);
    expect(groups[0].items.map(i => i.id)).toEqual(['new', 'old']);
  });

  it('returns an empty array for no items', () => {
    expect(groupPortalItemsByTopic([])).toEqual([]);
  });
});

describe('itemTopic / topicLabel', () => {
  it('itemTopic is null-safe for missing, non-string, and empty meta.topic', () => {
    expect(itemTopic(item('a'))).toBeUndefined();
    expect(itemTopic({ ...item('b'), meta: {} })).toBeUndefined();
    expect(itemTopic({ ...item('c'), meta: { topic: 42 as unknown as string } })).toBeUndefined();
    expect(itemTopic({ ...item('d'), meta: { topic: '' } })).toBeUndefined();
  });

  it('topicLabel maps known topics and falls back to Other', () => {
    expect(topicLabel('electrical')).toBe('Electrical');
    expect(topicLabel('controls-data')).toBe('Controls / Data');
    expect(topicLabel('software')).toBe('Other');
  });

  it('QUESTION_TOPICS mirrors the core enum values', () => {
    expect([...QUESTION_TOPICS]).toEqual(['electrical', 'mechanical', 'controls-data', 'thermal']);
  });
});

describe('cleanQuestionTitle', () => {
  it('strips asterisks and backticks', () => {
    expect(cleanQuestionTitle('Lithium-ion sub-chemistry and module architecture.**')).toBe('Lithium-ion sub-chemistry and module architecture.');
    expect(cleanQuestionTitle('**Q3.** Use `CAN` bus?')).toBe('Q3. Use CAN bus?');
  });

  it('strips leading junk characters and collapses whitespace', () => {
    expect(cleanQuestionTitle('/ BOM Q8 voltage   conflict; resolve')).toBe('BOM Q8 voltage conflict; resolve');
    expect(cleanQuestionTitle(' — ) . Pack voltage')).toBe('Pack voltage');
  });

  it('leaves a clean title unchanged and returns empty for junk-only input', () => {
    expect(cleanQuestionTitle('Main bus voltage?')).toBe('Main bus voltage?');
    expect(cleanQuestionTitle('**')).toBe('');
  });
});
