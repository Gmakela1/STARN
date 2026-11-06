import type { PortalItem } from '../types/api';

// One-line purpose: group open portal question items by their ICD-system
// topic tag (meta.topic) with a deterministic group order and an "Other"
// bucket for untagged/unknown topics.

/**
 * Mirror of QUESTION_TOPICS in src/specialists/open-questions.ts (web does
 * not import core sources — keep the two definitions in sync). Order here IS
 * the render order of topic groups in the question panel.
 */
export const QUESTION_TOPICS = ['electrical', 'mechanical', 'controls-data', 'thermal'] as const;

export type PortalTopic = (typeof QUESTION_TOPICS)[number] | 'other';

export interface PortalTopicGroup {
  topic: PortalTopic;
  /** Human-readable group header text. */
  label: string;
  /** Items in this group, preserving the incoming (newest-first) order. */
  items: PortalItem[];
}

const TOPIC_LABELS: Record<Exclude<PortalTopic, 'other'>, string> = {
  electrical: 'Electrical',
  mechanical: 'Mechanical',
  'controls-data': 'Controls / Data',
  thermal: 'Thermal'
};

/**
 * Reads a portal item's topic. Null-safe: missing/non-string/empty
 * meta.topic (pre-tag items) yields undefined.
 */
export function itemTopic(item: PortalItem): string | undefined {
  const raw = item.meta?.topic;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/**
 * Stable display label for a topic value; unknown topics render as "Other".
 */
export function topicLabel(topic: string): string {
  const known = topic as Exclude<PortalTopic, 'other'>;
  return TOPIC_LABELS[known] ?? 'Other';
}

/**
 * Partitions question items into topic groups. Group order follows
 * QUESTION_TOPICS, then "Other" for items with an undefined or
 * non-enum topic (unknown tags tolerated). The partition is stable, so
 * items keep the incoming ordering (newest-first from the portal list).
 *
 * @param items - question items (any subset; typically open items)
 * @returns only non-empty groups, in render order
 */
export function groupPortalItemsByTopic(items: PortalItem[]): PortalTopicGroup[] {
  const buckets = new Map<PortalTopic, PortalItem[]>();
  for (const item of items) {
    const raw = itemTopic(item);
    const known = raw !== undefined && (QUESTION_TOPICS as readonly string[]).includes(raw);
    const topic: PortalTopic = known ? (raw as PortalTopic) : 'other';
    const bucket = buckets.get(topic);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(topic, [item]);
    }
  }

  const groups: PortalTopicGroup[] = [];
  for (const topic of QUESTION_TOPICS) {
    const bucket = buckets.get(topic);
    if (bucket && bucket.length > 0) {
      groups.push({ topic, label: TOPIC_LABELS[topic], items: bucket });
    }
  }
  const other = buckets.get('other');
  if (other && other.length > 0) {
    groups.push({ topic: 'other', label: 'Other', items: other });
  }
  return groups;
}

/**
 * DISPLAY-ONLY title cleanup (never persisted — dedupe keys on the stored
 * title). Legacy model-written titles carry markdown junk such as
 * "Lithium-ion sub-chemistry.**" or a fragment starting "/ BOM Q8 …". Strips
 * every `*` and backtick, collapses whitespace, drops leading junk
 * punctuation (`/`, `-`, `–`, `—`, `.`, `)`, `:`, `;`, `,`, spaces) while keeping
 * legit openers such as `[` and `(`, and trims.
 *
 * @param title - stored portal item title
 * @returns the cleaned title ('' when only junk remains)
 */
export function cleanQuestionTitle(title: string): string {
  return title
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s/\-–—.):;,]+/, '')
    .trim();
}
