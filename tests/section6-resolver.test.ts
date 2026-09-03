import { describe, it, expect } from 'vitest';
import { parseSection6Questions } from '../src/cli/section6-resolver.js';

const sampleConops = `# CONOPS Test

## 1. Executive Summary
Some content here.

## 2. Operational Environment
Florida, flat terrain.

## 3. Use Cases & Modes
Mowing, loader work.

## 4. System Boundaries
Motor, battery, controller.

## 5. Safety & Community
HV safety, garage charging.

## 6. Open Questions & Items for Clarification

The following operational questions remain genuinely unresolved:

**Q1. Mid-mount mower deck drive path.** The user confirmed the mower deck is retained. This determines whether the electric motor must supply deck drive output.

**Q2. Charging dwell and recharge time.** It is not yet confirmed how much time is available between work sessions for recharging.

**Q3. Thermal behavior in the unconditioned garage.** The garage is not climate-controlled and sits in Florida heat.

## Additional Notes
Some notes here.
`;

const noSection6 = `# CONOPS Test

## 1. Executive Summary
Done.
`;

describe('Section 6 Resolver', () => {
  it('parseSection6Questions finds 3 questions', () => {
    const questions = parseSection6Questions(sampleConops);
    expect(questions).toHaveLength(3);
    expect(questions[0]).toContain('Mid-mount mower deck drive path');
    expect(questions[1]).toContain('Charging dwell and recharge time');
    expect(questions[2]).toContain('Thermal behavior');
  });

  it('parseSection6Questions returns empty for doc without Section 6', () => {
    expect(parseSection6Questions(noSection6)).toHaveLength(0);
  });

  it('parseSection6Questions returns empty for empty string', () => {
    expect(parseSection6Questions('')).toHaveLength(0);
  });

  it('question text captures full context including "Why it matters"', () => {
    const questions = parseSection6Questions(sampleConops);
    expect(questions[0].length).toBeGreaterThan(50);
    // Should include the explanatory text after the initial question
    expect(questions[0]).toContain('determines whether');
  });
});