import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseOpenQuestionEntries,
  parseOpenQuestionsFromContent,
  parseSection6Questions,
  extractQuestionSections,
  questionSlug,
  inferQuestionTopic,
  firstSentenceEnd,
  QUESTION_HEADER_CHAR_CAP
} from '../src/core/open-questions-parser.js';
import { OPEN_QUESTIONS_SECTION_RULES } from '../src/specialists/open-questions.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { addPortalItem } from '../src/core/question-portal.js';

const V2_DOC = `# Doc

## Open Questions

**Q1. [THERMAL] Which motor coolant is approved?**
BLUF: Use the 50/50 glycol loop per the thermal dossier.
Research findings: The thermal dossier baselines a 50/50 glycol loop; the Pump-X vendor datasheet confirms compatibility.
Main suggestion: Glycol 50/50 — cheap and compatible; trade-off: slightly worse heat capacity than straight water.
Alternatives: Straight water — best heat capacity but freezes below 0 C; dielectric fluid — no corrosion but 3x cost.
Defer: Deferring stalls the pump BOM line and the THERMAL.md baseline.
Why it matters: legacy background line.

**Q2. [ELECTRICAL] Bus voltage.** 48V or 72V?

## Next Section
`;

const LEGACY_DOC = `# Doc

## Open Questions

**Q1. System voltage.** 48V or 72V?
**Why it matters:** affects motor choice.

**Q2. Pilot diameter.** Not yet confirmed.

## Next Section
`;

describe('format-v2 question parsing (decision memo)', () => {
  it('extracts all labeled sections from a v2 entry', () => {
    const entries = parseOpenQuestionEntries(V2_DOC);
    expect(entries).toHaveLength(2);
    const first = entries[0];
    expect(first.title).toBe('[THERMAL] Which motor coolant is approved?');
    expect(first.sections?.bluf).toContain('50/50 glycol loop');
    expect(first.sections?.findings).toContain('thermal dossier');
    expect(first.sections?.suggestion).toContain('Glycol 50/50');
    expect(first.sections?.alternatives).toContain('Straight water');
    expect(first.sections?.defer).toContain('pump BOM line');
    // Legacy alias "Why it matters" maps to background context.
    expect(first.sections?.background).toContain('legacy background line');
  });

  it('title stays the parse key: v2 title slugs like a plain title', () => {
    const entries = parseOpenQuestionEntries(V2_DOC);
    expect(questionSlug(entries[0].title)).toBe(questionSlug('[THERMAL] Which motor coolant is approved?'));
  });

  it('legacy entries: sections undefined (or background only), titles unchanged', () => {
    const entries = parseOpenQuestionEntries(LEGACY_DOC);
    expect(entries).toHaveLength(2);
    // Existing legacy behavior: the mid-string closing bold marker is retained
    // verbatim (only trailing markers are stripped) — unchanged by format v2.
    expect(entries[0].title).toBe('System voltage.** 48V or 72V?');
    expect(entries[0].title).not.toContain('affects motor choice');
    expect(entries[0].sections?.background).toBe('affects motor choice.');
    expect(entries[0].sections?.bluf).toBeUndefined();
    expect(entries[0].sections?.suggestion).toBeUndefined();
    expect(entries[1].title).toBe('Pilot diameter.** Not yet confirmed.');
    expect(entries[1].sections).toBeUndefined();
  });

  it('parseOpenQuestionsFromContent returns the full question text, section labels stripped', () => {
    const titles = parseOpenQuestionsFromContent(V2_DOC);
    expect(titles).toHaveLength(2);
    expect(titles[0]).toBe('[THERMAL] Which motor coolant is approved?');
    expect(titles[0]).not.toContain('BLUF');
  });

  it('extractQuestionSections: no labels → undefined; partial labels → only those keys', () => {
    expect(extractQuestionSections('no labels at all')).toBeUndefined();
    const partial = extractQuestionSections('**Q1. Question.**\nDefer: blocks nothing automated.');
    expect(partial?.defer).toBe('blocks nothing automated.');
    expect(partial?.bluf).toBeUndefined();
  });

  it('meta.sections persists through the portal store', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-sections-persist-'));
    try {
      const stateManager = new ProjectStateManager(tmpDir);
      stateManager.getOrCreateState('p1', 'Sections Persist');
      addPortalItem(stateManager, {
        type: 'question',
        severity: 'normal',
        docPath: 'docs/CONOPS.md',
        title: 'Bus voltage.',
        source: 'autopilot',
        meta: {
          sections: {
            bluf: '48V nominal.',
            findings: 'CONOPS baseline. Sources: CONOPS.md',
            suggestion: '48V — matches the selected battery.',
            alternatives: '72V — lighter harness but no supplier.',
            defer: 'Blocks the electrical BOM.'
          }
        }
      });
      // Re-read from disk: sections survive persistence.
      const reloaded = new ProjectStateManager(tmpDir);
      const stored = (reloaded.getState().portalItems || []).find(i => i.title === 'Bus voltage.');
      expect(stored?.meta?.sections?.bluf).toBe('48V nominal.');
      expect(stored?.meta?.sections?.alternatives).toContain('72V');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('header = number + topic + short question only: trailing explanation is cut from the title', () => {
    // The bold header line carries ONLY the question; the explanation belongs
    // in the labeled sections. The parser must not trust the model here.
    const doc = '# Doc\n\n## Open Questions\n\n**Q2. [ELECTRICAL] Main bus voltage?** Because the load profile and the cranking spec disagree, we need to decide the nominal pack voltage this week.\n\n## Next Section\n';
    const entries = parseOpenQuestionEntries(doc);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('[ELECTRICAL] Main bus voltage?');
    expect(entries[0].title).not.toContain('Because');
    expect(entries[0].title).not.toContain('load profile');
  });

  it('a single long question with no sentence boundary is kept whole (no mid-question cut)', () => {
    const longQuestion =
      '[ELECTRICAL] Which PWM switching frequency should the traction inverter use to keep audible noise below the operator threshold?';
    expect(longQuestion.length).toBeGreaterThan(QUESTION_HEADER_CHAR_CAP);
    const doc = `# Doc\n\n## Open Questions\n\n**Q3. ${longQuestion}**\n\n## Next Section\n`;
    const entries = parseOpenQuestionEntries(doc);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe(longQuestion);
  });

  it('a header with no question mark is left intact (imperative / noun-phrase title)', () => {
    const doc = '# Doc\n\n## Open Questions\n\n**Q4. [MECHANICAL] Pilot diameter to be confirmed against the ME1115 shaft drawing**\n\n## Next Section\n';
    const entries = parseOpenQuestionEntries(doc);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe(
      '[MECHANICAL] Pilot diameter to be confirmed against the ME1115 shaft drawing'
    );
  });

  it('splits nested numbered "**Qn." sub-list lines into separate entries (F3 blob regression)', () => {
    // Parked-doc Section 6 bodies sometimes use a numbered sub-list; without
    // the "1. " variant in the entry boundary the second numbered question
    // was glued into the first entry's title as one blob.
    const doc = `# Doc\n\n## Open Questions\n\n**Q1. [ELECTRICAL] Main bus voltage.** 48 V or 72 V?\n1. **Q2. [ELECTRICAL] Verified 72 V continuous at the main bus?** Needs the load profile.\n2. **Q2. [ELECTRICAL] Verified 72 V peak under cranking?** Needs the crank spec.\n\n## Next Section\n`;
    const entries = parseOpenQuestionEntries(doc);
    expect(entries).toHaveLength(3);
    expect(entries[0].title).toContain('Main bus voltage');
    expect(entries[0].title).not.toMatch(/\d+\. \*\*Q2\./);
    expect(entries[1].title).toContain('Verified 72 V continuous at the main bus');
    expect(entries[2].title).toContain('Verified 72 V peak under cranking');
  });

  it('does not split a numbered bare "1. Q3 …" line inside a findings body (R1)', () => {
    const doc = '# Doc\n\n## Open Questions\n\n**Q1. [ELECTRICAL] Main bus voltage.** 48 V or 72 V?\n**Findings:**\n1. Q3 2024 revenue for the vendor grew 4%.\n2. Q4 results confirm the datasheet.\n\n## Next Section\n';
    const entries = parseOpenQuestionEntries(doc);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toContain('Main bus voltage');
  });
});

describe('abbreviation-safe header cut + raw-title preservation', () => {
  /** Parses ONE header line and returns the entry (title + rawTitle + sections). */
  const parseTitle = (header: string) =>
    parseOpenQuestionEntries(`# Doc\n\n## Open Questions\n\n**Q1. ${header}**\n\n## Next Section\n`)[0];

  it('the prompt rule and the parser cap cannot drift apart', () => {
    expect(QUESTION_HEADER_CHAR_CAP).toBe(90);
    expect(OPEN_QUESTIONS_SECTION_RULES).toContain('90 characters');
  });

  it('keeps an abbreviation-led over-cap header whole (No. / e.g. / i.e. / approx. / vs.)', () => {
    // The sentence-boundary cut must not fire on an abbreviation: the question
    // mark would be lost and the portal title would become "… use No.".
    const headers = [
      '[ELECTRICAL] Should we use No. 6 AWG cable for the main bus run, given the 100 A continuous rating and the 2 m length?',
      '[ELECTRICAL] Which conductor size should the harness use, e.g. A 6 AWG with a 2 m run, for the 100 A main bus today?',
      '[THERMAL] Is the coolant loop adequate, i.e. The drop stays under 3 percent, for the continuous 100 A main bus run today?',
      '[MECHANICAL] Does the approx. 2 m main bus run need a mid-span support clamp to survive the 5 g chassis vibration load?',
      '[MECHANICAL] Should the lug spec follow the 48 V vs. Kelly controller pack choice for the main bus run, pending confirmation?'
    ];
    for (const header of headers) {
      expect(header.length).toBeGreaterThan(QUESTION_HEADER_CHAR_CAP);
      const entry = parseTitle(header);
      expect(entry.title).toBe(header);
      expect(entry.rawTitle).toBe(header);
    }
  });

  it('never cuts on a "." that starts a digit or follows a short token (safe false-negatives)', () => {
    // "…rated 48 V. The pack…": the token before the "." is "V" (1 char), so the
    // ≥3-char token guard skips it. "run. 2 m length…": the next char is a
    // digit, not an uppercase letter, so it is not a boundary. Both degrade to
    // word-truncation / keep-whole (no data loss) — this pins that a future
    // "fix" cannot flip them into destructive cutters.
    const rated = 'The contactor is rated 48 V. The pack choice blocks the harness BOM line this week.';
    const length = 'Main bus run. 2 m length for the 100 A continuous rating, pending the harness survey.';
    expect(firstSentenceEnd(rated, rated.length)).toBe(-1);
    expect(firstSentenceEnd(length, length.length)).toBe(-1);
  });

  it('still cuts at a genuine sentence boundary inside an over-cap header', () => {
    const header =
      '[ELECTRICAL] Main bus voltage for the traction inverter is unresolved. The pack choice blocks the harness BOM line this week.';
    expect(header.length).toBeGreaterThan(QUESTION_HEADER_CHAR_CAP);
    const entry = parseTitle(header);
    expect(entry.title).toBe('[ELECTRICAL] Main bus voltage for the traction inverter is unresolved.');
    // The raw header stays on rawTitle (portal dedupe keys on it).
    expect(entry.rawTitle).toBe(header);
    // Nothing is lost: the cut sentence is retrievable as background context.
    expect(entry.sections?.background).toContain('blocks the harness BOM line');
  });

  it('the raw header survives on rawTitle when only the trailing explanation is dropped', () => {
    const header =
      '[ELECTRICAL] Main bus voltage? Because the load profile and the cranking spec disagree, we need to decide the nominal pack voltage this week.';
    const entry = parseTitle(header);
    expect(entry.title).toBe('[ELECTRICAL] Main bus voltage?');
    expect(entry.rawTitle).toBe(header);
    expect(entry.sections?.background).toContain('load profile and the cranking spec disagree');
  });

  it('never drops a tail that itself contains a "?" (quoted query / two-question header)', () => {
    const header =
      '[CONTROLS-DATA] Should the telemetry doc keep the query "?node=main" in the gateway link and expose it to operators?';
    const entry = parseTitle(header);
    expect(entry.title).toBe(header);
  });
});

describe('full question text on the string API (CLI resolver context)', () => {
  /** Wraps one header in a minimal doc for the doc-level parsers. */
  const docOf = (header: string) =>
    `# Doc\n\n## Open Questions\n\n**Q1. ${header}**\n\n## Next Section\n`;

  it('keeps a dropped "?"-tail in the string API while the title stays short', () => {
    const doc = docOf(
      '[ELECTRICAL] Main bus voltage? Because the load profile and the cranking spec disagree, we need to decide the nominal pack voltage this week.'
    );
    const entry = parseOpenQuestionEntries(doc)[0];
    expect(entry.title).toBe('[ELECTRICAL] Main bus voltage?');
    // rawTitle is the untrimmed header the string API hands the CLI resolver.
    expect(entry.rawTitle).toContain('cranking spec disagree');
    expect(entry.sections?.background).toContain('cranking spec disagree');
    const [question] = parseOpenQuestionsFromContent(doc);
    expect(question).toContain('Main bus voltage');
    expect(question).toContain('cranking spec disagree');
  });

  it('keeps a sentence cut from an over-cap header in the string API', () => {
    const doc = docOf(
      '[ELECTRICAL] Main bus voltage for the traction inverter is unresolved. The pack choice blocks the harness BOM line this week.'
    );
    const entry = parseOpenQuestionEntries(doc)[0];
    expect(entry.title).toBe('[ELECTRICAL] Main bus voltage for the traction inverter is unresolved.');
    expect(entry.sections?.background).toContain('blocks the harness BOM line');
    expect(parseOpenQuestionsFromContent(doc)[0]).toContain('blocks the harness BOM line');
  });

  it('legacy Section 6 entry: the CLI prompt string keeps the whole explanation', () => {
    const header =
      'Mid-mount mower deck drive path.** The user confirmed the mower deck is retained. This determines whether the electric motor must supply deck drive output.';
    const doc = docOf(header);
    const entry = parseOpenQuestionEntries(doc)[0];
    expect(entry.title).not.toContain('determines whether');
    expect(entry.sections?.background).toContain('determines whether');
    expect(parseOpenQuestionsFromContent(doc)[0]).toContain('determines whether');
    expect(parseSection6Questions(doc)[0]).toContain('determines whether');
  });
});

describe('inferQuestionTopic (R5 keyword inference)', () => {
  it('infers electrical', () => {
    expect(inferQuestionTopic('Fuse selectivity decision: branch fuse current rating and pack voltage')).toBe('electrical');
  });
  it('infers mechanical', () => {
    expect(inferQuestionTopic('ME1115 mounting bolt-circle discrepancy, chassis bracket clearance')).toBe('mechanical');
  });
  it('infers controls-data', () => {
    expect(inferQuestionTopic('Motor controller model selection and CAN DBC definition')).toBe('controls-data');
  });
  it('infers thermal', () => {
    expect(inferQuestionTopic('Coolant loop and heatsink derating at high ambient temperature')).toBe('thermal');
  });
  it('returns undefined for ambiguous or low-evidence text', () => {
    expect(inferQuestionTopic('What is the project name?')).toBeUndefined();
    expect(inferQuestionTopic('Battery fuse bracket bolt')).toBeUndefined();
    expect(inferQuestionTopic('')).toBeUndefined();
  });
  it('requires distinct evidence: subsumed prefixes do not double count', () => {
    expect(inferQuestionTopic('Main bus voltage?')).toBeUndefined();
    expect(inferQuestionTopic('Pack voltage and fuse rating')).toBe('electrical');
  });
  it('current/frame are whole-word tokens', () => {
    expect(inferQuestionTopic('We are currently reviewing the framework')).toBeUndefined();
    expect(inferQuestionTopic('continuous current rating of the pack')).toBe('electrical');
    expect(inferQuestionTopic('chassis frame bolt')).toBe('mechanical');
  });
  it('does not match short tokens inside longer words', () => {
    expect(inferQuestionTopic('Scan candidate scampi canal')).toBeUndefined();
  });
});
