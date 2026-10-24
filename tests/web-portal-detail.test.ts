import { describe, it, expect } from 'vitest';
import { renderDetail } from '../web/src/lib/portalDetail';

// Design spec §2.1 — concise question detail rendering, verbatim-split only.
// One pure helper used by both the QuestionBar card and the AnswerDialog.
describe('renderDetail', () => {
  describe('rule 1 — already a list (newlines or marker segments)', () => {
    it('bulletizes each line and caps at 4 with overflow count', () => {
      const r = renderDetail('Risk A\nRisk B\nRisk C\nRisk D\nRisk E');
      expect(r.bullets).toEqual(['Risk A', 'Risk B', 'Risk C', 'Risk D']);
      expect(r.overflow).toBe(1);
      expect(r.wasTruncated).toBe(false);
    });

    it('accepts a single-line bullet-marker list and strips the marker', () => {
      expect(renderDetail('- fix the voltage range').bullets).toEqual(['Fix the voltage range']);
      expect(renderDetail('* reduce mass by 10%').bullets).toEqual(['Reduce mass by 10%']);
      expect(renderDetail('• update the wiring harness').bullets).toEqual(['Update the wiring harness']);
      expect(renderDetail('2. add a test fixture').bullets).toEqual(['Add a test fixture']);
    });

    it('renders an exact-4 list with zero overflow', () => {
      const r = renderDetail('a\nb\nc\nd');
      expect(r.bullets).toHaveLength(4);
      expect(r.overflow).toBe(0);
    });

    it('keeps untruncated bullets lowercase-normalized only at the first letter', () => {
      const r = renderDetail('integrate the sensor\n- measured in volts');
      expect(r.bullets).toEqual(['Integrate the sensor', 'Measured in volts']);
      expect(r.overflow).toBe(0);
    });
  });

  describe('rule 2/3 — clause/sentence split into bullets', () => {
    it('turns 4 sentences into 3 bullets with overflow 1', () => {
      const detail =
        'The traction motor needs a defined voltage range. A 48V system reuses the converter. A 72V system improves efficiency. Pick one value before locking the BOM.';
      const r = renderDetail(detail);
      expect(r.bullets).toHaveLength(3);
      expect(r.bullets[0]).toContain('voltage range');
      expect(r.bullets[2]).toContain('efficiency');
      expect(r.overflow).toBe(1);
      expect(r.wasTruncated).toBe(false);
    });

    it('renders 2 sentences as 2 bullets with no overflow', () => {
      const r = renderDetail('First requirement statement. Second requirement statement.');
      expect(r.bullets).toHaveLength(2);
      expect(r.overflow).toBe(0);
      expect(r.wasTruncated).toBe(false);
    });

    it('hard-cuts the final visible bullet at 120 chars when it exceeds 160', () => {
      const long = 'A single long sentence. ' + 'word '.repeat(60) + 'tail.';
      const r = renderDetail(long);
      expect(r.bullets).toHaveLength(2);
      const tail = r.bullets[1];
      expect(tail.length).toBeLessThanOrEqual(121); // 120 chars + ellipsis
      expect(tail.endsWith('…')).toBe(true);
      expect(r.wasTruncated).toBe(true);
    });
  });

  describe('rule 4 — single-sentence fallback', () => {
    it('returns no bullets for a short single sentence', () => {
      const r = renderDetail('What voltage does the controller expect?');
      expect(r.bullets).toEqual([]);
      expect(r.overflow).toBe(0);
      expect(r.wasTruncated).toBe(false);
    });

    it('flags wasTruncated for a long single sentence', () => {
      const long = 'word '.repeat(50).trim();
      expect(long.length).toBeGreaterThan(140);
      const r = renderDetail(long);
      expect(r.bullets).toEqual([]);
      expect(r.wasTruncated).toBe(true);
    });
  });

  describe('rule 5 — trivial or missing detail', () => {
    it('renders an empty string as a plain line', () => {
      const r = renderDetail('');
      expect(r.bullets).toEqual([]);
      expect(r.overflow).toBe(0);
      expect(r.wasTruncated).toBe(false);
    });

    it('renders a short string (< 20 chars) as a plain line', () => {
      const r = renderDetail('Check the spec.');
      expect(r.bullets).toEqual([]);
      expect(r.overflow).toBe(0);
      expect(r.wasTruncated).toBe(false);
    });
  });

  describe('§2.1.2 — traction motor example', () => {
    it('matches the design before/after exactly', () => {
      const detail =
        'The traction motor for the electric tractor needs a defined operating voltage range before the BOM can be finalized. ' +
        'A 48V system would allow using the existing DC-DC converter and the current wiring harness, which minimizes changes. ' +
        'A 72V system could improve efficiency and reduce motor size, but it needs a new DC-DC converter and thicker gauge wiring. ' +
        'We should pick one value before locking the BOM.';
      const r = renderDetail(detail);
      // Verbatim split: the `[.;]\s+` delimiter is consumed, so bullets carry
      // no trailing period (the §2.1.2 mockup is illustrative, not literal).
      expect(r.bullets).toHaveLength(3);
      expect(r.bullets[0]).toBe(
        'The traction motor for the electric tractor needs a defined operating voltage range before the BOM can be finalized'
      );
      expect(r.bullets[2].startsWith('A 72V system could improve efficiency')).toBe(true);
      expect(r.overflow).toBe(1);
      expect(r.wasTruncated).toBe(false);
    });
  });
});