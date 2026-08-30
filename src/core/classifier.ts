import { OpenRouterClient } from '../openrouter/client.js';

const VALID_SPECIALISTS = [
  'general',
  'conops',
  'architecture',
  'icd',
  'capabilities',
  'requirements',
  'bom',
  'rtm',
  'milestones',
  'testplans',
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
    if (target === 'testplan' || target === 'test_plans' || target === 'testplans') return 'testplans';
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
    if (lower.includes('architecture') || lower.includes('subsystem') || lower.includes('block diagram')) return 'architecture';
    if (lower.includes('icd') || lower.includes('interface') || lower.includes('interface control')) return 'icd';
    if (lower.includes('bom') || lower.includes('bill of materials') || lower.includes('parts') || lower.includes('procurement')) return 'bom';
    if (lower.includes('test plan') || lower.includes('testplan') || lower.includes('procedures')) return 'testplans';
    if (lower.includes('rtm') || lower.includes('traceability')) return 'rtm';
    if (lower.includes('requirement') || lower.includes('srs')) return 'requirements';
    if (lower.includes('capability') || lower.includes('capabilities')) return 'capabilities';
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

  // 2. PHASE LOCKING: If the user is actively working on a formal deliverable
  // (i.e. not general/conops), their feedback and edits are directed at that
  // active specialist document, NOT at general Q&A.
  if (activePhase && activePhase !== 'general' && activePhase !== 'conops') {
    // Only route away if it's an explicit informational question (starts with "what is", "tell me", etc.)
    // AND it doesn't contain edit/update/revise/feedback keywords
    const lower = userMessage.trim().toLowerCase();
    const isEditFeedback =
      lower.startsWith('update') ||
      lower.startsWith('change') ||
      lower.startsWith('add') ||
      lower.startsWith('remove') ||
      lower.startsWith('revise') ||
      lower.startsWith('edit') ||
      lower.startsWith('fix') ||
      lower.startsWith('include') ||
      lower.startsWith('modify') ||
      lower.includes('instead of') ||
      lower.includes('change the') ||
      lower.includes('add a') ||
      lower.includes('remove the') ||
      lower.includes('feedback') ||
      lower.includes('correction') ||
      lower.includes('wrong') ||
      lower.includes('that should be') ||
      lower.includes('should say') ||
      lower.includes('battery') ||
      lower.includes('motor') ||
      lower.includes('charger') ||
      lower.includes('compartment') ||
      lower.includes('seat') ||
      lower.includes('display');

    if (isEditFeedback) {
      return activePhase;
    }
  }

  // 3. Check if this is an informational query or question (should route to general Q&A)
  if (isInformationalQuery(userMessage)) {
    return 'general';
  }

  const prompt = `You are the Request Classifier for STARN, a physical/hardware engineering project management AI.
Classify the user's request into EXACTLY ONE of the following specialist IDs:
- "general": Informational questions, scoping discussion, status queries, summaries, or advice that does NOT author/rewrite a formal engineering deliverable.
- "conops": Authoring/updating Concept of operations, user intent, operational environments, system boundaries, or initial project intake.
- "architecture": Authoring/updating system architecture, subsystem decomposition, block diagrams, dependency graphs.
- "icd": Authoring/updating Interface Control Document, mechanical/electrical/data/thermal interface definitions.
- "capabilities": Authoring/updating per-subsystem functional capabilities, behavioral character traits (SS-01.a, SS-01.b).
- "requirements": Authoring/updating per-subsystem engineering requirements, quantifiable constraints, physical tolerances (Requirement SS-01.a).
- "bom": Authoring/updating Bill of Materials, candidate parts, datasheet links, long-lead procurement items, design decisions.
- "rtm": Authoring/updating Requirements Traceability Matrix, verification methods (Inspect, Test, Demo, Analysis).
- "milestones": Authoring/updating development phases, gating criteria (MVC, IOC, FOC), acceptance gates.
- "testplans": Authoring/updating shop test plans, verification procedures (TP-MVP-xx, TP-IOC-xx, TP-FOC-xx), and tooling interviews.
- "sow": Authoring/updating Statement of Work, vendor/contractor deliverables, project scope agreement.
- "change-impact": Cross-cutting change impact analysis — flagging which downstream documents need updating when upstream documents change.

Active Project Workflow Phase: "${activePhase || 'conops'}"
IMPORTANT RULES:
- If the user is providing edits, revisions, corrections, or feedback about an existing document, route to the Active Workflow Phase specialist.
- Only return "general" for purely informational queries.
- Only return an authoring specialist if the user intends to CREATE, REVISE, or UPDATE a formal document.

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
  if (lower.includes('test plan') || lower.includes('testplan') || lower.includes('test procedure')) return 'testplans';
  if (lower.includes('rtm') || lower.includes('traceability') || lower.includes('verification matrix')) return 'rtm';
  if (lower.includes('conops') || lower.includes('intent') || lower.includes('concept') || lower.includes('start')) return 'conops';
  if (lower.includes('architecture') || lower.includes('subsystem') || lower.includes('block diagram')) return 'architecture';
  if (lower.includes('icd') || lower.includes('interface control')) return 'icd';
  if (lower.includes('bom') || lower.includes('bill of materials') || lower.includes('parts')) return 'bom';
  if (lower.includes('capability') || lower.includes('capabilities') || lower.includes('behavior')) return 'capabilities';
  if (lower.includes('requirement') || lower.includes('spec') || lower.includes('srs')) return 'requirements';
  if (lower.includes('milestone') || lower.includes('gate') || lower.includes('ioc') || lower.includes('foc')) return 'milestones';
  if (lower.includes('sow') || lower.includes('statement of work')) return 'sow';
  if (lower.includes('impact') || lower.includes('what changes') || lower.includes('affect')) return 'change-impact';

  return activePhase || 'general';
}
