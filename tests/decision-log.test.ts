import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { harvestDecisionLog } from '../src/cli/checkpoint.js';

describe('Decision Log Harvest', () => {
  let tmpDir: string;

  it('extracts Design Decisions section from a document', () => {
    const docContent = `# Architecture
## 1. Block Diagram
...
## Design Decisions
### D-001: 72V Nominal DC Bus
- **Date:** 2026-09-01
- **Phase:** Architecture
- **Decision:** 72V nominal DC bus voltage
- **Alternatives Considered:** 48V, 96V
- **Rationale:** Sweet spot for motor and controller availability
- **Source:** Architecture §3
- **Status:** ✅ Final

### D-002: LiFePO4 Chemistry
- **Date:** 2026-09-05
- **Phase:** BOM
- **Decision:** LiFePO4 over NMC
- **Alternatives Considered:** NMC, Lead-Acid
- **Rationale:** Safety and cycle life
- **Source:** BOM §2
- **Status:** ✅ Final
`;

    const decisionsStart = docContent.indexOf('## Design Decisions');
    expect(decisionsStart).toBeGreaterThanOrEqual(0);

    const afterHeader = docContent.slice(decisionsStart);
    // Should contain both D-001 and D-002
    expect(afterHeader).toContain('D-001');
    expect(afterHeader).toContain('D-002');
  });

  it('appends extracted decisions to DECISIONS.md without duplicating', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-decision-test-'));
    const decisionsPath = path.join(tmpDir, 'DECISIONS.md');

    // Simulate the harvest function
    const existingEntry = `## D-001: 72V Nominal DC Bus
- **Date:** 2026-09-01
- **Phase:** Architecture
- **Decision:** 72V nominal DC bus voltage
- **Status:** ✅ Final
`;
    fs.writeFileSync(decisionsPath, existingEntry, 'utf-8');

    const newEntry = `## D-002: LiFePO4 Chemistry
- **Date:** 2026-09-05
- **Phase:** BOM
- **Decision:** LiFePO4 over NMC
- **Status:** ✅ Final
`;

    // Append (simulating harvest)
    const currentContent = fs.readFileSync(decisionsPath, 'utf-8');
    // Check D-002 is not already present (idempotent check)
    if (!currentContent.includes('D-002')) {
      fs.writeFileSync(decisionsPath, currentContent + '\n' + newEntry, 'utf-8');
    }

    const final = fs.readFileSync(decisionsPath, 'utf-8');
    expect(final).toContain('D-001');
    expect(final).toContain('D-002');

    // Test idempotency: run again, should not duplicate
    const secondRun = fs.readFileSync(decisionsPath, 'utf-8');
    if (!secondRun.includes('D-002')) {
      fs.writeFileSync(decisionsPath, secondRun + '\n' + newEntry, 'utf-8');
    }
    const afterSecondRun = fs.readFileSync(decisionsPath, 'utf-8');
    // Count occurrences of D-002
    const matches = afterSecondRun.match(/D-002/g);
    expect(matches).toHaveLength(1); // idempotent — no duplicate
  });

  it('returns early if no Design Decisions section is found', () => {
    const docContent = `# CONOPS
## 1. Executive Summary
No design decisions here.
`;
    const decisionsStart = docContent.indexOf('## Design Decisions');
    expect(decisionsStart).toBe(-1);
  });

  it('harvestDecisionLog extracts real section and appends to DECISIONS.md', () => {
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-harvest-integration-'));
    const docsDir = path.join(projDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });

    const archDoc = `# Architecture
## 1. Block Diagram
...
## Design Decisions
### D-101: 72V Nominal DC Bus
- **Decision:** 72V nominal DC bus voltage
- **Rationale:** Sweet spot for motor availability
- **Status:** ✅ Final
## 2. Next Section
something else
`;
    fs.writeFileSync(path.join(docsDir, 'ARCHITECTURE.md'), archDoc, 'utf-8');

    const count = harvestDecisionLog(projDir, 'architecture');
    expect(count).toBe(1);

    const decisionsPath = path.join(docsDir, 'DECISIONS.md');
    expect(fs.existsSync(decisionsPath)).toBe(true);
    const content = fs.readFileSync(decisionsPath, 'utf-8');
    expect(content).toContain('D-101');
    expect(content).toContain('72V nominal DC bus voltage');
    // Should NOT include the next section
    expect(content).not.toContain('Next Section');

    // Idempotency: second harvest returns 0 and does not duplicate
    const secondCount = harvestDecisionLog(projDir, 'architecture');
    expect(secondCount).toBe(0);
    const afterSecond = fs.readFileSync(decisionsPath, 'utf-8');
    const matches = afterSecond.match(/D-101/g);
    expect(matches).toHaveLength(1);

    fs.rmSync(projDir, { recursive: true, force: true });
  });

  it('harvestDecisionLog returns 0 when specialist doc has no Design Decisions section', () => {
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-harvest-noddec-'));
    const docsDir = path.join(projDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'CONOPS.md'), '# CONOPS\n## 1. Executive Summary\nplain\n', 'utf-8');

    const count = harvestDecisionLog(projDir, 'conops');
    expect(count).toBe(0);
    expect(fs.existsSync(path.join(docsDir, 'DECISIONS.md'))).toBe(false);

    fs.rmSync(projDir, { recursive: true, force: true });
  });
});