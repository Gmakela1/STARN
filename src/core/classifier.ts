import { OpenRouterClient } from '../openrouter/client.js';

const VALID_SPECIALISTS = [
  'general',
  'conops',
  'capabilities',
  'requirements',
  'rtm',
  'milestones',
  'wbs',
  'sow'
];

export function isInformationalQuery(userMessage: string): boolean {
  const lower = userMessage.trim().toLowerCase();

  // Explicit authoring action verbs
  const isAuthoringAction =
    lower.startsWith('draft ') ||
    lower.startsWith('create ') ||
    lower.startsWith('generate ') ||
    lower.startsWith('write ') ||
    lower.startsWith('build ') ||
    lower.startsWith('update ') ||
    lower.startsWith('modify ') ||
    lower.startsWith('revise ') ||
    lower.startsWith('add ') ||
    lower.startsWith('remove ') ||
    lower.startsWith('delete ') ||
    lower.startsWith('change ') ||
    lower.startsWith('redo ') ||
    lower.startsWith('synthesize ');

  if (isAuthoringAction) {
    return false;
  }

  // Question patterns / summary requests
  const isQuestionOrSummary =
    lower.startsWith('tell me') ||
    lower.startsWith('what is') ||
    lower.startsWith('what are') ||
    lower.startsWith('what were') ||
    lower.startsWith('what was') ||
    lower.startsWith('what did') ||
    lower.startsWith('how is') ||
    lower.startsWith('how does') ||
    lower.startsWith('how do') ||
    lower.startsWith('why did') ||
    lower.startsWith('why is') ||
    lower.startsWith('summarize') ||
    lower.startsWith('summary') ||
    lower.startsWith('explain') ||
    lower.startsWith('show me') ||
    lower.startsWith('describe') ||
    lower.startsWith('can you explain') ||
    lower.startsWith('can you tell me') ||
    lower.startsWith('can you summarize') ||
    lower.includes('what is the end goal') ||
    lower.includes('what was the end goal') ||
    lower.endsWith('?');

  return isQuestionOrSummary;
}

export function detectPhaseSwitchRequest(userMessage: string): string | null {
  const lower = userMessage.trim().toLowerCase();

  // Command formats: /goto <phase>, /phase <phase>, /switch <phase>
  const cmdMatch = lower.match(/^\/(?:goto|phase|switch)\s+([a-z0-9_-]+)/i);
  if (cmdMatch) {
    const target = cmdMatch[1].toLowerCase();
    if (VALID_SPECIALISTS.includes(target)) return target;
  }

  // Natural language explicit switch expressions
  const isRedoOrSwitch =
    lower.includes('redo') ||
    lower.includes('switch to') ||
    lower.includes('jump to') ||
    lower.includes('go to phase') ||
    lower.includes('restart');

  if (isRedoOrSwitch) {
    if (lower.includes('conops') || lower.includes('intent') || lower.includes('concept')) return 'conops';
    if (lower.includes('rtm') || lower.includes('traceability')) return 'rtm';
    if (lower.includes('requirement') || lower.includes('srs')) return 'requirements';
    if (lower.includes('capability') || lower.includes('capabilities')) return 'capabilities';
    if (lower.includes('wbs') || lower.includes('work breakdown')) return 'wbs';
    if (lower.includes('milestone') || lower.includes('gating')) return 'milestones';
    if (lower.includes('sow') || lower.includes('statement of work')) return 'sow';
  }

  return null;
}

export async function classifyRequest(
  userMessage: string,
  client: OpenRouterClient,
  model: string,
  activePhase?: string
): Promise<string> {
  // 1. Check for explicit phase switch request
  const explicitSwitch = detectPhaseSwitchRequest(userMessage);
  if (explicitSwitch) {
    return explicitSwitch;
  }

  // 2. Check if this is an informational query or question (should route to general Q&A, NOT rewrite documents)
  if (isInformationalQuery(userMessage)) {
    return 'general';
  }

  const prompt = `You are the Request Classifier for STARN, a physical/hardware engineering project management AI.
Classify the user's request into EXACTLY ONE of the following specialist IDs:
- "general": Informational questions, scoping discussion, status queries, summaries, or advice that does NOT author/rewrite a formal engineering deliverable.
- "conops": Authoring/updating Concept of operations, user intent, operational environments, system boundaries, or initial project intake.
- "capabilities": Authoring/updating functional capabilities, behavioral character traits (1.a, 1.b).
- "requirements": Authoring/updating engineering requirements, quantifiable constraints, physical tolerances (Requirement 1.a).
- "rtm": Authoring/updating Requirements Traceability Matrix, verification methods (Test, Inspection, Analysis, Demonstration).
- "milestones": Authoring/updating development phases, gating criteria (MVP, IOC, FOC), acceptance gates.
- "wbs": Authoring/updating Work Breakdown Structure, deliverables, component hierarchical breakdown.
- "sow": Authoring/updating Statement of Work, vendor/contractor deliverables, project scope agreement.

Active Project Workflow Phase: "${activePhase || 'conops'}"
Note: If the user is asking an informational question, querying decisions, or asking for a summary, return "general". Only return an authoring specialist if the user intends to CREATE, REVISE, or UPDATE a formal document.

User Request: "${userMessage}"

Respond with ONLY a JSON object: {"specialistId": "<id>", "reason": "<brief reason>"}`;

  try {
    const res = await client.chatCompletion({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    });

    const jsonMatch = (res.content || '').match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (VALID_SPECIALISTS.includes(parsed.specialistId)) {
        return parsed.specialistId;
      }
    }
  } catch (_e) {
    // Fallback on keywords if LLM classification fails
  }

  const lower = userMessage.toLowerCase();
  if (lower.includes('rtm') || lower.includes('traceability') || lower.includes('verification matrix')) return 'rtm';
  if (lower.includes('conops') || lower.includes('intent') || lower.includes('concept') || lower.includes('start')) return 'conops';
  if (lower.includes('capability') || lower.includes('capabilities') || lower.includes('behavior')) return 'capabilities';
  if (lower.includes('requirement') || lower.includes('spec') || lower.includes('srs')) return 'requirements';
  if (lower.includes('wbs') || lower.includes('work breakdown')) return 'wbs';
  if (lower.includes('milestone') || lower.includes('gate') || lower.includes('ioc') || lower.includes('foc')) return 'milestones';
  if (lower.includes('sow') || lower.includes('statement of work')) return 'sow';

  return activePhase || 'general';
}
