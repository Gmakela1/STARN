import { OpenRouterClient } from '../openrouter/client.js';

const VALID_SPECIALISTS = ['general', 'conops', 'capabilities', 'milestones', 'wbs', 'sow'];

export async function classifyRequest(
  userMessage: string,
  client: OpenRouterClient,
  model: string
): Promise<string> {
  const prompt = `You are the Request Classifier for STARN, a physical/hardware engineering project management AI.
Classify the user's request into EXACTLY ONE of the following specialist IDs:
- "general": General questions, scoping discussion, status queries, or advice that does NOT produce a formal engineering document.
- "conops": Concept of operations, user intent, operational environments, system boundaries.
- "capabilities": Engineering capabilities, physical specs, load/power/thermal requirements.
- "milestones": Development phases, gating criteria (MVP, IOC, FOC), acceptance gates.
- "wbs": Work Breakdown Structure, deliverables, component hierarchical breakdown.
- "sow": Statement of Work, vendor/contractor deliverables, project scope agreement.

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
  if (lower.includes('conops') || lower.includes('intent') || lower.includes('concept')) return 'conops';
  if (lower.includes('wbs') || lower.includes('work breakdown')) return 'wbs';
  if (lower.includes('milestone') || lower.includes('gate') || lower.includes('ioc') || lower.includes('foc')) return 'milestones';
  if (lower.includes('requirement') || lower.includes('capability') || lower.includes('spec')) return 'capabilities';
  if (lower.includes('sow') || lower.includes('statement of work')) return 'sow';

  return 'general';
}
