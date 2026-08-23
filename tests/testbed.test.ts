import { describe, it, expect, vi } from 'vitest';
import { TestbedRunner } from '../testbed/runner.js';
import { OpenRouterClient } from '../src/openrouter/client.js';

describe('Autonomous Testbed', () => {
  it('loads test suites with prompts and grading rubrics', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    const runner = new TestbedRunner(mockClient);
    const suites = runner.loadTestSuites();
    expect(suites.length).toBeGreaterThanOrEqual(3);
    expect(suites.some(s => s.id === 'solar_shed_wbs')).toBe(true);
    expect(suites.some(s => s.id === 'deployable_shelter_conops')).toBe(true);
    expect(suites.some(s => s.id === 'tractor_ev_rtm')).toBe(true);
  });

  it('grades generated artifact against criteria accurately', () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    const runner = new TestbedRunner(mockClient);

    const artifact = `# WBS: Off-Grid Solar Generator
## 1.0 Foundation & Substructure
- 1.1 6x 12" Concrete Piers with 5/8" J-bolts
## 2.0 Framing & Envelope
- 2.1 2x6 framing 16" OC
## 3.0 Electrical & Solar
- 3.1 3.2kW Solar Array with 48V inverter
## 4.0 Commissioning & Testing
- 4.1 4-hour load test and ground resistance`;

    const grade = runner.gradeArtifact(artifact, {
      requiredHeadings: ['Foundation', 'Framing', 'Electrical', 'Commissioning'],
      requiredKeywords: ['2x6', 'J-bolts', 'inverter', 'load test'],
      minWordCount: 30
    });

    expect(grade.passed).toBe(true);
    expect(grade.matchedHeadings).toEqual(expect.arrayContaining(['Foundation', 'Framing', 'Electrical', 'Commissioning']));
    expect(grade.score).toBeGreaterThanOrEqual(9.0);
  });

  it('grades tabular RTM deliverables with pass/fail thresholds', () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    const runner = new TestbedRunner(mockClient);

    const rtmContent = `# Requirements Traceability Matrix
| Req ID | Requirement Summary | Method | Required Tooling / Setup | Quantitative Pass/Fail Threshold |
| :--- | :--- | :--- | :--- | :--- |
| **Requirement 1.a** | Thermal Operating Range | Test | Climatic walk-in chamber | Continuous operation at -20°C & +45°C for 60 min |
| **Requirement 1.b** | Enclosure Ingress Protection | Test | Water spray nozzle | IP66 certified, 0 liquid penetration |
| **Requirement 2.a** | DC Bus Operating Voltage | Test | Fluke Multimeter & CAN logger | Bus voltage between 60.0V and 84.0V DC |`;

    const grade = runner.gradeArtifact(rtmContent, {
      requiredHeadings: ['Requirements Traceability Matrix'],
      requiredKeywords: ['Req ID', 'Method', 'Tooling', 'Threshold', 'Requirement 1.a'],
      minWordCount: 30
    });

    expect(grade.passed).toBe(true);
    expect(grade.score).toBeGreaterThanOrEqual(9.0);
  });
});
