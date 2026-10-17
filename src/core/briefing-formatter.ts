import { CharterSection } from './conops-overview.js';

export interface BriefingData {
  projectName: string;
  activePhase: string;
  conopsSummary?: string;
  charter?: CharterSection[];
  financials: {
    totalEstimated: number;
    totalActual: number;
    netVariance: number;
  };
  phases: Array<{
    id: string;
    name: string;
    status: string;
    criticScore?: number;
  }>;
  openIssues: Array<{
    title: string;
    type: string;
  }>;
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Headless plain-text briefing formatter for terminal display.
 * Page 1 contains Project Overview & Charter.
 * Page 2 begins with Financial & Procurement Rollup, followed by Governance & Status.
 */
export function formatExecutiveBriefingPlain(data: BriefingData): string {
  const divider = '='.repeat(68);
  const subDivider = '-'.repeat(68);

  const lines: string[] = [
    divider,
    `★ STARN EXECUTIVE BRIEFING: ${data.projectName}`,
    `Active Phase Gate: [${data.activePhase.toUpperCase()}] | Generated: ${new Date().toLocaleDateString()}`,
    divider,
    '',
    '1. PROJECT OVERVIEW & CHARTER',
    subDivider
  ];

  if (data.charter && data.charter.length > 0) {
    for (const section of data.charter) {
      lines.push(`[${section.heading}]`);
      for (const line of section.body.split('\n')) {
        lines.push(`  ${line}`);
      }
      lines.push('');
    }
  } else {
    lines.push(
      data.conopsSummary ? data.conopsSummary : 'System scope established per approved program baseline.'
    );
    lines.push('');
  }

  // Page 2 Boundary
  lines.push('');
  lines.push('=== PAGE 2: EXECUTION GOVERNANCE & FINANCIALS ===');
  lines.push('');
  lines.push('2. FINANCIAL & PROCUREMENT ROLLUP');
  lines.push(subDivider);
  lines.push(`Total Estimated Budget:      ${money(data.financials.totalEstimated)}`);
  lines.push(`Actual Committed Spend:      ${money(data.financials.totalActual)}`);
  lines.push(
    `Net Budget Variance:         ${data.financials.netVariance > 0 ? '+' : ''}${money(data.financials.netVariance)}`
  );
  lines.push('');

  lines.push('3. PHASE-GATE MILESTONE STATUS');
  lines.push(subDivider);
  for (let i = 0; i < data.phases.length; i++) {
    const p = data.phases[i];
    const score = p.criticScore !== undefined ? ` [Score: ${p.criticScore.toFixed(1)}]` : '';
    lines.push(`  ${(i + 1).toString().padStart(2)}. [${p.status.padEnd(14)}] ${p.name}${score}`);
  }

  lines.push('');
  lines.push('4. CRITICAL RISKS & OPEN DEFECTS');
  lines.push(subDivider);

  if (data.openIssues.length === 0) {
    lines.push('  No open hardware non-conformances or critical risks.');
  } else {
    for (const issue of data.openIssues) {
      lines.push(`  - [${issue.type.toUpperCase()}] ${issue.title}`);
    }
  }

  lines.push(divider);
  return lines.join('\n');
}

/**
 * Headless Markdown briefing formatter suitable for saving to docs/EXECUTIVE_BRIEFING.md.
 */
export function formatExecutiveBriefingMarkdown(data: BriefingData): string {
  const lines: string[] = [
    `# Executive Briefing: ${data.projectName}`,
    `**Active Phase:** ${data.activePhase.toUpperCase()}  `,
    `**Generated:** ${new Date().toISOString().split('T')[0]}  `,
    `**Program Baseline:** STARN AI Engineering Management`,
    '',
    '## 1. Project Overview & Charter'
  ];

  if (data.charter && data.charter.length > 0) {
    for (const section of data.charter) {
      lines.push(`### ${section.heading}`);
      lines.push(section.body);
      lines.push('');
    }
  } else {
    lines.push(
      data.conopsSummary ? data.conopsSummary : 'System scope established per approved program baseline.'
    );
    lines.push('');
  }

  lines.push('## 2. Financial & Procurement Rollup');
  lines.push('| Metric | Amount |');
  lines.push('| :--- | :--- |');
  lines.push(`| Total Estimated Budget | **${money(data.financials.totalEstimated)}** |`);
  lines.push(`| Total Actual Committed Spend | **${money(data.financials.totalActual)}** |`);
  lines.push(
    `| Net Variance | **${data.financials.netVariance > 0 ? '+' : ''}${money(data.financials.netVariance)}** |`
  );
  lines.push('');

  lines.push('## 3. Phase-Gate Milestone Status');
  lines.push('| # | Milestone Phase | Status | Critic Review Score |');
  lines.push('| :---: | :--- | :---: | :---: |');

  for (let i = 0; i < data.phases.length; i++) {
    const p = data.phases[i];
    const score = p.criticScore !== undefined ? `${p.criticScore.toFixed(1)} / 10` : '—';
    lines.push(`| ${i + 1} | ${p.name} | ${p.status} | ${score} |`);
  }

  lines.push('');
  lines.push('## 4. Hardware Non-Conformances & Open Items');
  if (data.openIssues.length === 0) {
    lines.push('No open non-conformances or critical unresolved items.');
  } else {
    for (const issue of data.openIssues) {
      lines.push(`- **[${issue.type.toUpperCase()}]** ${issue.title}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
