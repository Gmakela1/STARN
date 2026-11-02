/**
 * Portal research gate (portal research gate package): a second-chance
 * research pass for portal questions that survived the drafting-time
 * preflight. Runs POST-INTAKE, async, non-blocking — the specialist's turn
 * completes without waiting on research turns.
 *
 * Flow per NEW open question item:
 *   1. runQuestionResearch — read-only agent loop (fs_read/fs_list/state_read/
 *      web_search, maxTurns RESEARCH_GATE_MAX_TURNS, fresh priorMessages) that
 *      returns { answer, sources, reasoning } parsed tolerantly from STRICT
 *      JSON (brace-extract precedent from the critic).
 *   2. assessResearch — dedicated research critic (same evaluate-client
 *      pattern as the document critic): source authority tiering, evidence
 *      directness, consistency with recorded user answers / approved baseline
 *      (conflict = fail), assumption count. Emits { confidence, verdict,
 *      rationale }. The researcher does NOT self-grade.
 *   3. verdict routing:
 *      - confidence >= AUTO_APPLY_CONFIDENCE → applyAutoAnswer: the answer
 *        flows through the SAME answer-applier path a user answer takes
 *        (pending block append, answerHistory provenance, incorporation
 *        trigger), meta.autoApplied snapshot enables UNDO until incorporation.
 *      - usable candidate below threshold → meta.proposedAnswer (YES/NO/EDIT
 *        on the panel; confirm routes through the answer-applier with
 *        'user-confirmed-research' provenance).
 *      - exhausted/no candidate → plain open question (today's behavior).
 *
 * All model-supplied text is sanitized (research-preflight sanitizeResearchLine
 * reuse: heading forgery + fence-marker neutralization). Every state mutation
 * is a synchronous read-fresh→mutate→save block (atomic vs other async work in
 * this process). Failure discipline: ANY error leaves the item as a plain open
 * question (meta.researching cleared), emits a status event, never throws.
 * Presentation-free: core-safe, no UI/CLI imports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ChatClient } from '../openrouter/types.js';
import { SearchClient } from '../tools/search/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { ToolExecutionContext } from '../tools/types.js';
import { ProjectStateManager } from '../workspace/state.js';
import { PortalItem, ResearchSource } from '../workspace/types.js';
import { runAgentToolLoop } from './agent-loop.js';
import { Logger } from '../util/logger.js';
import {
  PREFLIGHT_ALLOWED_TOOLS,
  sanitizeResearchLine,
  buildSettledDecisionsSection
} from './research-preflight.js';

/** Research-turn allow-list: reads + web research only — no write tools. */
export const RESEARCH_GATE_ALLOWED_TOOLS = [...PREFLIGHT_ALLOWED_TOOLS] as string[];
export const RESEARCH_GATE_MAX_TURNS = 6;
/** Critic confidence at or above which the answer auto-applies. */
export const AUTO_APPLY_CONFIDENCE = 0.95;
/** Critic confidence at or above which a usable candidate is proposed (below → none). */
export const PROPOSE_CONFIDENCE_FLOOR = 0.3;
/** Hard character caps for model-supplied fields. */
const ANSWER_CHAR_CAP = 4000;
const REASONING_CHAR_CAP = 1000;
const SOURCE_CAP = 6;

export interface QuestionResearch {
  answer: string;
  sources: ResearchSource[];
  reasoning: string;
}

export type ResearchVerdict = 'auto' | 'propose' | 'none';

export interface ResearchAssessment {
  confidence: number;
  verdict: ResearchVerdict;
  rationale: string;
}

export interface ResearchGateDeps {
  /** Research-loop client (drafting role). */
  client: ChatClient;
  model: string;
  /** Research-critic client (critic role). */
  criticClient: ChatClient;
  criticModel: string;
  projectPath: string;
  stateManager: ProjectStateManager;
  toolRegistry: ToolRegistry;
  /** Injected search client (tests); unset → web_search handler lazily creates one. */
  searchClient?: SearchClient;
  /**
   * The session-wired answer-applier call (applyAnswer with its full deps —
   * executeTurn, busy guard, status/phase/event sinks). The gate routes
   * auto-apply and user-confirmed proposals through this so provenance,
   * pending-block appends and the incorporation trigger behave exactly like a
   * user-submitted answer. Returns the applied result incl. appendedText.
   */
  applyAnswer: (itemId: string, answer: string) => Promise<{
    updatedItem: PortalItem;
    appendedText?: string;
  }>;
  /** Optional status-event sink (SSE). */
  emitStatus?: (message: string) => void;
  signal?: AbortSignal;
  logger?: Logger;
}

export interface UndoAutoDeps {
  stateManager: ProjectStateManager;
  projectPath: string;
  logger?: Logger;
  emitStatus?: (message: string) => void;
}

/**
 * Short display title for status events: Qn prefix stripped, hard-capped.
 */
export function shortResearchTitle(title: string): string {
  const stripped = title.replace(/^Q\d+[\.:)]\s*/, '');
  return stripped.length > 60 ? stripped.slice(0, 57) + '…' : stripped;
}

/**
 * Sanitizes one model-supplied multi-line field: every line through
 * sanitizeResearchLine (heading forgery / setext underline / fence-marker
 * neutralization from research-preflight), then char-capped.
 */
function sanitizeField(text: string, cap: number): string {
  const sanitized = (text || '')
    .split('\n')
    .map(sanitizeResearchLine)
    .join('\n')
    .trim();
  return sanitized.length > cap ? sanitized.slice(0, cap) : sanitized;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

/**
 * Tolerant parser for the research turn's final reply (JSON brace-extract
 * precedent: critic.ts / parseScopingPlan). Accepts prose-wrapped JSON.
 * Fields sanitized (sanitizeResearchLine per line) and capped.
 * Returns null when no usable answer can be recovered.
 */
export function parseResearchReply(text: string): QuestionResearch | null {
  if (!text || !text.trim()) return null;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof obj.answer !== 'string' || !obj.answer.trim()) return null;

  const sources: ResearchSource[] = [];
  if (Array.isArray(obj.sources)) {
    for (const raw of obj.sources.slice(0, SOURCE_CAP)) {
      if (!raw || typeof raw !== 'object') continue;
      const s = raw as Record<string, unknown>;
      const title = typeof s.title === 'string' ? s.title.trim() : '';
      const url = typeof s.url === 'string' ? s.url.trim() : undefined;
      if (!title && !url) continue;
      sources.push({
        title: sanitizeField(title, 200),
        url: url && /^https?:\/\//i.test(url) ? url : undefined
      });
    }
  }

  return {
    answer: sanitizeField(obj.answer, ANSWER_CHAR_CAP),
    sources,
    reasoning: typeof obj.reasoning === 'string' ? sanitizeField(obj.reasoning, REASONING_CHAR_CAP) : ''
  };
}

/**
 * One read-only research turn for ONE portal question. Fresh priorMessages, so
 * the transcript never enters sessionMessages. Tolerant: returns null on any
 * failure or empty/unparseable output — never throws (ESC abort propagates).
 */
export async function runQuestionResearch(deps: ResearchGateDeps, item: PortalItem): Promise<QuestionResearch | null> {
  const systemPrompt = `You are the Research Gate agent for STARN, a hardware engineering project assistant.
Your ONLY job is to research ONE open question so the user may not have to answer it manually.
You are read-only: never write or edit files. Use web_search for external facts (manufacturer spec sheets, datasheets, official documentation, standards), and fs_read/fs_list for project documents, reference materials and recorded answers.
Exhaust, in priority order: manufacturer/datasheet sources, official documentation, the project's own docs and recorded answers, reputable engineering publications.
Your final reply must contain ONLY a JSON object (no markdown fence, no commentary) in this exact shape:
{"answer": "<direct factual answer, one concise paragraph>", "sources": [{"title": "<source name>", "url": "<URL if web, omit if project doc>"}], "reasoning": "<how the sources support the answer; note any assumptions>"}
If the question is a judgment call, opinion, or cannot be verified from a source, reply {"answer": "", "sources": [], "reasoning": "<why it is not verifiable>"}.`;

  const parts = [
    `QUESTION: ${item.title}`,
    item.detail ? `CONTEXT: ${item.detail}` : '',
    buildSettledDecisionsSection(deps.stateManager, deps.projectPath),
    `TASK: Research this question, then reply with ONLY the JSON object from your instructions.`
  ];
  const userMessage = parts.filter(Boolean).join('\n\n');

  const context: ToolExecutionContext = {
    projectPath: deps.projectPath,
    stateManager: deps.stateManager,
    signal: deps.signal,
    searchClient: deps.searchClient
  };

  try {
    const result = await runAgentToolLoop({
      client: deps.client,
      model: deps.model,
      systemPrompt,
      userMessage,
      toolRegistry: deps.toolRegistry,
      allowedTools: [...RESEARCH_GATE_ALLOWED_TOOLS],
      context,
      maxTurns: RESEARCH_GATE_MAX_TURNS,
      priorMessages: [],
      signal: deps.signal,
      logger: deps.logger,
      docId: 'research-gate'
    });
    return parseResearchReply(result.finalResponse || '');
  } catch (err: any) {
    if (err?.name === 'AbortError' || deps.signal?.aborted) {
      throw err; // ESC must abort, not degrade silently.
    }
    deps.logger?.warn(`Research turn failed for item ${item.id}: ${err?.message || err}`);
    return null;
  }
}

/** Research-critic rubric (dedicated — the judge, not the researcher's self-report). */
export const RESEARCH_CRITIC_RUBRIC = `RESEARCH ASSESSMENT RUBRIC (grade the candidate answer AGAINST ITS SOURCES):
1. SOURCE AUTHORITY (dominant factor):
   - Manufacturer spec sheet / datasheet / official product documentation / adopted standard = 0.90-1.00 confidence.
   - Reputable engineering publication / textbook / established reference = 0.70-0.85.
   - Forum post, SEO article, vendor blog or marketing page = 0.30-0.50.
   - No source, or a source that does not actually state the answer = confidence 0.
2. EVIDENCE DIRECTNESS: a source that STATES the answer verbatim is strong; an answer INFERRED or extrapolated from related specs loses one tier.
3. CONSISTENCY (automatic fail): if the candidate answer conflicts with any recorded user answer or approved project baseline listed below, confidence MUST be <= 0.30 regardless of source quality.
4. ASSUMPTION COUNT: each unstated assumption the answer relies on deducts ~0.10.

Respond ONLY with valid JSON in this exact structure:
{"confidence": <number 0.00-1.00>, "verdict": "auto" | "propose" | "none", "rationale": "<one short paragraph: which sources drove the confidence and any conflicts found>"}`;

/**
 * Research critic: dedicated rubric, same evaluate-client pattern as the
 * document critic (critic.ts) — raw client call, temperature 0.1, tolerant
 * JSON brace-extract with clamped confidence. Never throws: unparseable or
 * failed verdicts degrade to { confidence: 0, verdict: 'none' }.
 */
export async function assessResearch(
  deps: ResearchGateDeps,
  item: PortalItem,
  research: QuestionResearch
): Promise<ResearchAssessment> {
  const fallback: ResearchAssessment = { confidence: 0, verdict: 'none', rationale: 'Research critic did not return a parseable verdict.' };
  try {
    const prompt = [
      `You are the Research Critic for STARN. Judge ONE researched candidate answer for a portal question. You did NOT produce it — grade it independently.`,
      RESEARCH_CRITIC_RUBRIC,
      `QUESTION: ${item.title}`,
      `CANDIDATE ANSWER:\n${research.answer}`,
      research.sources.length > 0
        ? `CITED SOURCES:\n${research.sources.map(s => `- ${s.title}${s.url ? ` (${s.url})` : ''}`).join('\n')}`
        : 'CITED SOURCES: none',
      research.reasoning ? `RESEARCHER REASONING (unverified self-report — weigh it lower than the sources):\n${research.reasoning}` : '',
      buildSettledDecisionsSection(deps.stateManager, deps.projectPath),
      'Respond ONLY with the JSON object from the rubric.'
    ].filter(Boolean).join('\n\n');

    const response = await deps.criticClient.chatCompletion({
      model: deps.criticModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      signal: deps.signal
    });

    const jsonMatch = (response.content || '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      deps.logger?.warn(`Research critic returned no JSON for item ${item.id}`);
      return fallback;
    }
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      return fallback;
    }
    const confidence = typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
      ? Math.min(1, Math.max(0, obj.confidence))
      : 0;
    const rationale = typeof obj.rationale === 'string' ? sanitizeField(obj.rationale, REASONING_CHAR_CAP) : '';
    const rawVerdict = obj.verdict;
    // Verdict is DERIVED from the clamped confidence (critic text is advisory):
    // auto >= AUTO_APPLY_CONFIDENCE; propose >= PROPOSE_CONFIDENCE_FLOOR; else none.
    let verdict: ResearchVerdict;
    if (confidence >= AUTO_APPLY_CONFIDENCE) verdict = 'auto';
    else if (confidence >= PROPOSE_CONFIDENCE_FLOOR) verdict = 'propose';
    else verdict = 'none';
    if (rawVerdict === 'none') verdict = 'none';
    return { confidence, verdict, rationale };
  } catch (err: any) {
    if (err?.name === 'AbortError' || deps.signal?.aborted) {
      throw err;
    }
    deps.logger?.warn(`Research critic failed for item ${item.id}: ${err?.message || err}`);
    return fallback;
  }
}

/**
 * Marks (or clears) meta.researching on an item — synchronous read-fresh →
 * mutate → save (atomic vs other async work in this process).
 */
export function setItemResearching(stateManager: ProjectStateManager, itemId: string, researching: boolean): void {
  const state = stateManager.getState();
  const item = (state.portalItems || []).find(i => i.id === itemId);
  if (!item) return;
  item.meta = { ...(item.meta || {}), researching };
  stateManager.saveState(state);
}

/**
 * Stores meta.proposedAnswer on an open item (atomic read-fresh → mutate →
 * save). Returns false when the item vanished or is no longer open.
 */
export function storeProposal(
  stateManager: ProjectStateManager,
  itemId: string,
  proposal: { answer: string; sources: ResearchSource[]; confidence: number; rationale: string }
): boolean {
  const state = stateManager.getState();
  const item = (state.portalItems || []).find(i => i.id === itemId);
  if (!item || item.status !== 'open') return false;
  item.meta = {
    ...(item.meta || {}),
    researching: false,
    proposedAnswer: {
      answer: proposal.answer,
      sources: proposal.sources,
      confidence: proposal.confidence,
      rationale: proposal.rationale
    }
  };
  stateManager.saveState(state);
  return true;
}

/**
 * Clears meta.proposedAnswer (user rejected the proposal) — item stays a
 * plain open question. Returns false when there is no proposal to clear.
 */
export function clearProposal(stateManager: ProjectStateManager, itemId: string): boolean {
  const state = stateManager.getState();
  const item = (state.portalItems || []).find(i => i.id === itemId);
  if (!item || !item.meta?.proposedAnswer) return false;
  const meta = { ...(item.meta || {}) };
  delete meta.proposedAnswer;
  item.meta = meta;
  stateManager.saveState(state);
  return true;
}

/**
 * AUTO-APPLY executor: routes the researched answer through the answer-applier
 * (deps.applyAnswer — the SAME path a user answer takes: pending-block append,
 * answerHistory provenance, openRemaining recount + incorporation trigger),
 * then stamps meta.autoApplied (answer, appendedText snapshot, confidence,
 * sources, rationale) so the UNDO window can remove the appended text exactly.
 */
export async function applyAutoAnswer(
  deps: ResearchGateDeps,
  item: PortalItem,
  assessment: ResearchAssessment,
  research: QuestionResearch
): Promise<boolean> {
  const result = await deps.applyAnswer(item.id, research.answer);
  const state = deps.stateManager.getState();
  const stored = (state.portalItems || []).find(i => i.id === item.id);
  if (!stored) return false;
  stored.meta = {
    ...(stored.meta || {}),
    researching: false,
    autoApplied: {
      answer: research.answer,
      appendedText: result.appendedText,
      confidence: assessment.confidence,
      sources: research.sources,
      rationale: assessment.rationale
    }
  };
  deps.stateManager.saveState(state);
  return true;
}

/**
 * UNDO executor: removes the stored appendedText EXACTLY from the doc's
 * pending-answers block (string replace; when the removal empties the block —
 * i.e. this apply created it — the marker goes with it), re-opens the item,
 * and clears meta.autoApplied. Throws (route maps to an error) when the item
 * was never auto-applied or the pending block is already incorporated.
 */
export async function undoAutoApplied(deps: UndoAutoDeps, itemId: string): Promise<PortalItem> {
  const state = deps.stateManager.getState();
  const item = (state.portalItems || []).find(i => i.id === itemId);
  if (!item) {
    throw new Error(`Portal item not found: ${itemId}`);
  }
  const auto = item.meta?.autoApplied;
  if (!auto) {
    throw new Error(`Portal item ${itemId} has no auto-applied research answer`);
  }
  if (item.status !== 'answered') {
    throw new Error(`Portal item ${itemId} is not answered (${item.status})`);
  }

  if (auto.appendedText && item.docPath) {
    const docFilePath = path.join(deps.projectPath, item.docPath);
    let content: string | null = null;
    try {
      content = fs.readFileSync(docFilePath, 'utf-8');
    } catch {
      content = null;
    }
    if (content === null) {
      throw new Error(`Document not found for ${item.docPath} — cannot undo`);
    }
    if (!content.includes(auto.appendedText)) {
      throw new Error('Auto-applied answer already incorporated — undo no longer available');
    }
    const updated = content.replace(auto.appendedText, '');
    fs.writeFileSync(docFilePath, updated, 'utf-8');
  }

  // Re-open: atomic read-fresh → mutate → save. answerHistory is kept (audit
  // record); the item becomes a plain open question again.
  const fresh = deps.stateManager.getState();
  const stored = (fresh.portalItems || []).find(i => i.id === itemId);
  if (stored) {
    stored.status = 'open';
    stored.answer = undefined;
    stored.updatedAt = new Date().toISOString();
    const meta = { ...(stored.meta || {}) };
    delete meta.autoApplied;
    stored.meta = { ...meta, researching: false };
    deps.stateManager.saveState(fresh);
  }
  deps.logger?.warn(`Auto-applied research answer undone for portal item ${itemId}`);
  deps.emitStatus?.(`Auto-applied answer withdrawn — question reopened: ${shortResearchTitle(item.title)}`);
  return stored ?? item;
}

/**
 * Gate orchestrator for ONE item: researching → research turn → critic →
 * verdict routing. NEVER throws and NEVER blocks the drafting turn: any error
 * leaves the item as a plain open question (meta.researching cleared) with a
 * status event. Runs POST-INTAKE (async).
 */
export async function runResearchGate(deps: ResearchGateDeps, item: PortalItem): Promise<void> {
  const short = shortResearchTitle(item.title);
  try {
    if (item.status !== 'open' || item.type !== 'question' || !item.docPath) return;
    if (item.meta?.researching === true || item.meta?.proposedAnswer || item.meta?.autoApplied) return;

    setItemResearching(deps.stateManager, item.id, true);
    deps.emitStatus?.(`Researching answer for: ${short}`);

    const research = await runQuestionResearch(deps, item);
    if (!research || !research.answer.trim()) {
      setItemResearching(deps.stateManager, item.id, false);
      deps.emitStatus?.(`Research exhausted for: ${short} — left as open question`);
      return;
    }

    const assessment = await assessResearch(deps, item, research);
    setItemResearching(deps.stateManager, item.id, false);

    if (assessment.verdict === 'auto') {
      deps.emitStatus?.(`Research answer auto-applied (${Math.round(assessment.confidence * 100)}% confidence): ${short}`);
      const applied = await applyAutoAnswer(deps, item, assessment, research);
      if (!applied) {
        deps.emitStatus?.(`Research exhausted for: ${short} — left as open question`);
      }
      return;
    }
    if (assessment.verdict === 'propose') {
      const stored = storeProposal(deps.stateManager, item.id, {
        answer: research.answer,
        sources: research.sources,
        confidence: assessment.confidence,
        rationale: assessment.rationale
      });
      deps.emitStatus?.(stored
        ? `Research proposal ready for review: ${short}`
        : `Research exhausted for: ${short} — left as open question`);
      return;
    }
    deps.emitStatus?.(`Research exhausted for: ${short} — left as open question`);
  } catch (err: any) {
    try {
      setItemResearching(deps.stateManager, item.id, false);
    } catch {
      // state write failure — the next listing still renders the plain item
    }
    deps.logger?.warn(`Research gate failed for item ${item.id}: ${err?.message || err}`);
    deps.emitStatus?.(`Research failed for: ${short} — left as open question`);
  }
}
