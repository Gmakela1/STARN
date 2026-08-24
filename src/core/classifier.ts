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

export function detectPhaseSwitchRequest(userMessage: string): string | null {
  const lower = userMessage.trim().toLowerCase();

  // Command formats: /goto <phase>, /phase <phase>, /switch <phase>
  const cmdMatch = lower.match(/^\/(?:goto|phase|switch)\s+([a-z0-9_-]+)/i);
  if (cmdMatch) {
    const target = cmdMatch[1].toLowerCase();
    if (VALID_SPECIALISTS.includes(target)) return target;
  }

  // Natural language explicit switch expressions
  const isRedoOrSwitch = lower.includes('redo') || lower.includes('switch to') || lower.includes('jump to') || lower.includes('go to phase') || lower.includes('restart');

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
  // 1. Check for explicit phase switch request first
  const explicitSwitch = detectPhaseSwitchRequest(userMessage);
  if (explicitSwitch) {
    return explicitSwitch;
  }

  const prompt = `You are the Request Classifier for STARN, a physical/hardware engineering project management AI.
Classify the user's request into EXACTLY ONE of the following specialist IDs:
- "general": General questions, scoping discussion, status queries, or advice that does NOT produce a formal engineering document.
- "conops": Concept of operations, user intent, operational environments, system boundaries, or initial project intake.
- "capabilities": Functional capabilities, behavioral character traits (1.a, 1.b).
- "requirements": Engineering requirements, quantifiable constraints, physical tolerances (Requirement 1.a).
- "rtm": Requirements Traceability Matrix, verification methods (Test, Inspection, Analysis, Demonstration).
- "milestones": Development phases, gating criteria (MVP, IOC, FOC), acceptance gates.
- "wbs": Work Breakdown Structure, deliverables, component hierarchical breakdown.
- "sow": Statement of Work, vendor/contractor deliverables, project scope agreement.

Active Project Workflow Phase: "${activePhase || 'conops'}"
Note: If the user is refining, adding details, or making corrections to the currently active phase without explicitly switching phases, prefer routing to the active phase ("${activePhase || 'conops'}").

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
