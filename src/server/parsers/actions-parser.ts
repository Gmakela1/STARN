/**
 * Headless parser for work instruction documents in docs/work_instructions/.
 * Extracts the header metadata, step-by-step checklist, evidence artifacts,
 * and the hardware non-conformance log; supports surgical checkbox toggles.
 */

export interface WorkInstructionStep {
  /** 0-based index among checklist steps (Section 2 only). */
  index: number;
  label: string;
  text: string;
  checked: boolean;
  /** True when the step is an inline gated test plan execution. */
  gated: boolean;
  /** Line number in the source markdown (0-based). */
  line: number;
}

export interface NonConformanceLog {
  flagStatus: string;
  defectDescription: string;
  defectEvidence: string;
  recommendation: string;
}

export interface StepComment {
  /** Comment body. */
  text: string;
  /** ISO timestamp when the comment was posted. */
  at: string;
  /** Optional author label (defaults to 'shop floor'). */
  author?: string;
}

/** Per-step shop-floor annotations, keyed by 0-based step index (as string). */
export interface StepAnnotations {
  [stepId: string]: {
    comments?: StepComment[];
    flagged?: boolean;
  };
}

export interface ParsedWorkInstruction {
  actionId: string;
  title: string;
  status: string;
  milestoneGate: string;
  subsystem: string;
  steps: WorkInstructionStep[];
  artifacts: string[];
  nonConformance: NonConformanceLog;
  stepAnnotations?: StepAnnotations;
  fileName?: string;
}

const STEP_REGEX = /^-\s*\[([ xX])\]\s*\*\*(Step\s*\d+)[:\s]*(?:\[?([^\]]*)\]?)?\*\*[:\s]*(.*)$/;

function extractField(markdown: string, field: string): string {
  const regex = new RegExp(`\\*\\*${field}:\\*\\*\\s*(.*)`, 'i');
  const match = markdown.match(regex);
  return match ? match[1].trim() : '';
}

function extractLogField(section: string, field: string): string {
  const regex = new RegExp(`-\\s*\\*\\*${field}[:\\s]*\\*\\*[:\\s]*(.*)`, 'i');
  const match = section.match(regex);
  return match ? match[1].replace(/`/g, '').trim() : '';
}

export function parseWorkInstruction(markdown: string, fileName?: string): ParsedWorkInstruction {
  const lines = markdown.split('\n');

  // Header: "# Work Instruction: ACTION-03 — Mount Electric Motor..."
  const titleLine = lines.find(l => l.startsWith('# ')) ?? '';
  const actionMatch = titleLine.match(/ACTION-(\d+)/i);
  const actionId = actionMatch ? `ACTION-${actionMatch[1].padStart(2, '0')}` : (fileName?.match(/ACTION-\d+/i)?.[0].toUpperCase() ?? '');
  const title = titleLine.replace(/^#\s*/, '').trim();

  const status = extractField(markdown, 'Status');
  const milestoneGate = extractField(markdown, 'Milestone Gate');
  const subsystem = extractField(markdown, 'Target Subsystem');

  // Steps: only within the Step-by-Step checklist section.
  const steps: WorkInstructionStep[] = [];
  let inChecklist = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) {
      inChecklist = /step-by-step/i.test(line);
      continue;
    }
    if (!inChecklist) continue;
    const match = line.match(STEP_REGEX);
    if (match) {
      const checked = match[1].toLowerCase() === 'x';
      const label = match[2].trim();
      const bracketText = (match[3] ?? '').trim();
      const trailing = (match[4] ?? '').trim();
      const gated = /GATED TEST PLAN EXECUTION/i.test(line);
      const text = [bracketText, trailing].filter(Boolean).join(' ').trim();
      steps.push({ index: steps.length, label, text, checked, gated, line: i });
    }
  }

  // Artifacts: every reference to the flat artifacts/ repository.
  const artifacts: string[] = [];
  const artifactRegex = /artifacts\/[A-Za-z0-9._\-]+/g;
  let artifactMatch;
  while ((artifactMatch = artifactRegex.exec(markdown)) !== null) {
    if (!artifacts.includes(artifactMatch[0])) artifacts.push(artifactMatch[0]);
  }

  // Non-conformance log: Section 4.
  const logStart = markdown.search(/##\s*(?:\d+\.?\s*)?Hardware Non-Conformance/i);
  const logSection = logStart >= 0 ? markdown.slice(logStart) : '';
  const nonConformance: NonConformanceLog = {
    flagStatus: extractLogField(logSection, 'Flag Status') || 'NONE',
    defectDescription: extractLogField(logSection, 'Defect Description'),
    defectEvidence: extractLogField(logSection, 'Defect Evidence / Media') || extractLogField(logSection, 'Defect Evidence'),
    recommendation: extractLogField(logSection, 'AI Recommendation / Resolution') || extractLogField(logSection, 'AI Recommendation')
  };

  return { actionId, title, status, milestoneGate, subsystem, steps, artifacts, nonConformance, stepAnnotations: parseStepAnnotations(markdown), fileName };
}

/**
 * Marker for the persisted step-annotations block. Kept as an HTML comment so
 * markdown renderers ignore it and checklist line edits never touch it.
 */
const ANNOTATIONS_BLOCK_RE = /<!--\s*STARN-STEP-ANNOTATIONS\s*\n([\s\S]*?)\n\s*-->\s*$/;

function parseStepAnnotations(markdown: string): StepAnnotations {
  ANNOTATIONS_BLOCK_RE.lastIndex = 0;
  const match = markdown.match(ANNOTATIONS_BLOCK_RE);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as StepAnnotations;
    }
  } catch {
    // Tolerate a malformed block; treat it as empty.
  }
  return {};
}

function serializeAnnotationsBlock(annotations: StepAnnotations): string {
  return `<!-- STARN-STEP-ANNOTATIONS\n${JSON.stringify(annotations, null, 2)}\n-->`;
}

function withAnnotations(markdown: string, annotations: StepAnnotations): string {
  const block = serializeAnnotationsBlock(annotations);
  const existing = markdown.match(ANNOTATIONS_BLOCK_RE);
  if (existing && existing.index !== undefined) {
    return markdown.slice(0, existing.index).trimEnd() + '\n\n' + block + '\n';
  }
  return markdown.trimEnd() + '\n\n' + block + '\n';
}

/**
 * Toggles a checklist step checkbox (by step index within Section 2) and
 * returns the updated markdown. All other lines are preserved byte-for-byte.
 */
export function toggleWorkInstructionStep(markdown: string, stepIndex: number, checked: boolean): string {
  const parsed = parseWorkInstruction(markdown);
  const step = parsed.steps[stepIndex];
  if (!step) {
    throw new Error(`Step index ${stepIndex} out of range (document has ${parsed.steps.length} steps)`);
  }

  const lines = markdown.split('\n');
  const line = lines[step.line];
  lines[step.line] = line.replace(/^(-\s*)\[([ xX])\]/, `$1[${checked ? 'x' : ' '}]`);
  return lines.join('\n');
}

/**
 * Appends a shop-floor comment to a step (by index within Section 2) and
 * returns the updated markdown with the persisted annotations block rewritten.
 * Mirrors toggleWorkInstructionStep: pure markdown-in/markdown-out.
 */
export function postStepComment(markdown: string, stepId: number, text: string, author?: string): string {
  const parsed = parseWorkInstruction(markdown);
  const step = parsed.steps[stepId];
  if (!step) {
    throw new Error(`Step index ${stepId} out of range (document has ${parsed.steps.length} steps)`);
  }
  const annotations = parsed.stepAnnotations ?? {};
  const key = String(stepId);
  const entry = annotations[key] ?? {};
  const comment: StepComment = {
    text,
    at: new Date().toISOString(),
    ...(author ? { author } : {})
  };
  return withAnnotations(markdown, {
    ...annotations,
    [key]: { ...entry, comments: [...(entry.comments ?? []), comment] }
  });
}

/**
 * Sets or clears the shop-floor flag on a step (by index within Section 2) and
 * returns the updated markdown with the persisted annotations block rewritten.
 * Mirrors toggleWorkInstructionStep: pure markdown-in/markdown-out.
 */
export function toggleStepFlag(markdown: string, stepId: number, flagged: boolean): string {
  const parsed = parseWorkInstruction(markdown);
  const step = parsed.steps[stepId];
  if (!step) {
    throw new Error(`Step index ${stepId} out of range (document has ${parsed.steps.length} steps)`);
  }
  const annotations = parsed.stepAnnotations ?? {};
  const key = String(stepId);
  const entry = annotations[key] ?? {};
  return withAnnotations(markdown, {
    ...annotations,
    [key]: { ...entry, flagged }
  });
}
