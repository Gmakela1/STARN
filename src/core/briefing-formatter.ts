export interface BriefingData {
  projectName: string;
  activePhase: string;
  conopsSummary?: string;
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
    '1. SYSTEM & OPERATIONAL OVERVIEW',
    subDivider,
    data.conopsSummary ? data.conopsSummary : 'System scope established per approved program baseline.',
    '',
    '2. FINANCIAL & PROCUREMENT ROLLUP',
    subDivider,
    `Total Estimated Budget:      ${money(data.financials.totalEstimated)}`,
    `Actual Committed Spend:      ${money(data.financials.totalActual)}`,
    `Net Budget Variance:         ${data.financials.netVariance > 0 ? '+' : ''}${money(data.financials.netVariance)}`,
    '',
    '3. PHASE-GATE MILESTONE STATUS',
    subDivider
  ];

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
    '## Executive Summary & Intent',
    data.conopsSummary ? data.conopsSummary : 'System scope established per approved program baseline.',
    '',
    '## Financial Rollup',
    '| Metric | Amount |',
    '| :--- | :--- |',
    `| Total Estimated Budget | **${money(data.financials.totalEstimated)}** |`,
    `| Total Actual Committed Spend | **${money(data.financials.totalActual)}** |`,
    `| Net Variance | **${data.financials.netVariance > 0 ? '+' : ''}${money(data.financials.netVariance)}** |`,
    '',
    '## Phase-Gate Milestone Status',
    '| # | Milestone Phase | Status | Critic Review Score |',
    '| :---: | :--- | :---: | :---: |'
  ];

  for (let i = 0; i < data.phases.length; i++) {
    const p = data.phases[i];
    const score = p.criticScore !== undefined ? `${p.criticScore.toFixed(1)} / 10` : '—';
    lines.push(`| ${i + 1} | ${p.name} | ${p.status} | ${score} |`);
  }

  lines.push('');
  lines.push('## Hardware Non-Conformances & Open Items');
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
