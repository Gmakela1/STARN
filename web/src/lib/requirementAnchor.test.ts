import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import Markdown from '../components/Markdown';
import {
  applyAnchorHighlight,
  clearAnchorHighlights,
  extractRequirementIds,
  findAnchorBlock,
  pickAnchorId,
} from './requirementAnchor';

// Design §5.C + §9 — requirement-ID extraction, doc-presence anchoring, and
// persistent highlight on a rendered .doc-prose block.

describe('extractRequirementIds', () => {
  it('extracts known ids in order and dedupes', () => {
    expect(extractRequirementIds('SS-01 SS-09.a SS-01 ICD-E-01 WI-1 MECH-01')).toEqual([
      'SS-01',
      'SS-09.a',
      'ICD-E-01',
      'WI-1',
      'MECH-01',
    ]);
  });

  it('also extracts lookalike tokens (SHA-256, PDF-1.4) — expected false positives', () => {
    expect(extractRequirementIds('Compare SHA-256 with PDF-1.4')).toEqual(['SHA-256', 'PDF-1.4']);
  });

  it('returns an empty array for text without ids', () => {
    expect(extractRequirementIds('no ids in here at all')).toEqual([]);
  });
});

describe('pickAnchorId', () => {
  it('rejects candidates absent from the doc (false-positive shield)', () => {
    expect(pickAnchorId(['SHA-256', 'SS-09.a'], 'Nothing about either token.')).toBeNull();
  });

  it('accepts the first candidate present in the doc', () => {
    expect(pickAnchorId(['SHA-256', 'SS-09.a'], 'Refer to SS-09.a for the limit.')).toBe('SS-09.a');
  });

  it('returns null for empty ids or empty content', () => {
    expect(pickAnchorId([], 'anything')).toBeNull();
    expect(pickAnchorId(['SS-01'], '')).toBeNull();
  });
});

describe('findAnchorBlock', () => {
  const content = [
    '# Traction Drive',
    '',
    '## 5.0 Voltage Limits',
    '',
    'The traction motor must remain within SS-09.a during normal operation.',
    '',
    '## 6.0 Wiring',
    '',
    'Use 12 AWG conductors.',
  ].join('\n');

  it('returns the block text plus the nearest preceding heading', () => {
    const r = findAnchorBlock(content, 'SS-09.a');
    expect(r).not.toBeNull();
    expect(r!.blockText).toContain('SS-09.a');
    expect(r!.headingText).toBe('5.0 Voltage Limits');
  });

  it('captures a heading on the same block', () => {
    const r = findAnchorBlock('## Voltage\nMotor meets SS-09.a here.', 'SS-09.a');
    expect(r!.headingText).toBe('Voltage');
    expect(r!.blockText).toContain('SS-09.a');
  });

  it('returns null when the id is absent', () => {
    expect(findAnchorBlock(content, 'NOPE-99')).toBeNull();
    expect(findAnchorBlock(content, '')).toBeNull();
  });
});

describe('applyAnchorHighlight (jsdom, rendered Markdown)', () => {
  const doc = '## 5.0 Voltage Limits\n\nThe motor must stay within SS-09.a at all times.\n\n## Wiring\n\nUse 12 AWG.';

  beforeEach(() => {
    // jsdom has no real scrollIntoView; record calls instead of throwing.
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('marks and rings the block, persisting until explicitly cleared', () => {
    const { container } = render(createElement(Markdown, { content: doc }));
    const root = container.querySelector('.doc-prose') as HTMLElement;
    const paragraph = Array.from(root.querySelectorAll('p')).find(p => p.textContent?.includes('SS-09.a')) as HTMLElement;

    const el = applyAnchorHighlight(root, 'SS-09.a');
    expect(el).toBe(paragraph);
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute('data-studio-anchor');
    expect(el).toHaveClass('animate-anchor-flash');
    expect(el!.querySelector('[data-studio-anchor-marker]')?.textContent).toBe('SS-09.a');
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();

    // No auto-clear: the marker must persist past any animation window until
    // clearAnchorHighlights is called (doc change, edit, panel close, new focus).
    vi.advanceTimersByTime(5000);

    expect(el).toHaveAttribute('data-studio-anchor');
    expect(el).toHaveClass('animate-anchor-flash');
    expect(el!.querySelector('[data-studio-anchor-marker]')).not.toBeNull();

    clearAnchorHighlights(container);

    expect(el).not.toHaveAttribute('data-studio-anchor');
    expect(el).not.toHaveClass('animate-anchor-flash');
    expect(el!.querySelector('[data-studio-anchor-marker]')).toBeNull();
  });

  it('returns null when no block contains the id', () => {
    const { container } = render(createElement(Markdown, { content: '## Voltage\n\nNothing to anchor here.' }));
    const root = container.querySelector('.doc-prose') as HTMLElement;
    expect(applyAnchorHighlight(root, 'SS-09.a')).toBeNull();
  });

  it('clearAnchorHighlights removes the highlight and marker immediately', () => {
    const { container } = render(createElement(Markdown, { content: doc }));
    const root = container.querySelector('.doc-prose') as HTMLElement;
    const paragraph = Array.from(root.querySelectorAll('p')).find(p => p.textContent?.includes('SS-09.a')) as HTMLElement;

    applyAnchorHighlight(root, 'SS-09.a');
    expect(paragraph).toHaveAttribute('data-studio-anchor');

    clearAnchorHighlights(container);
    expect(paragraph).not.toHaveAttribute('data-studio-anchor');
    expect(paragraph).not.toHaveClass('animate-anchor-flash');
    expect(paragraph.querySelector('[data-studio-anchor-marker]')).toBeNull();
  });
});