/**
 * Shared Open Questions convention applied to every specialist document.
 * The section heading "## Open Questions" (numeric prefix optional) is the
 * canonical, parseable location for unresolved questions in any deliverable,
 * enabling the roadmap panel to flag documents and the pre-turn interview to
 * collect user answers for LLM incorporation.
 */
/**
 * ICD-system topic enum for open questions — mirrors the four mandatory
 * interface categories (E/M/D/T) declared in the ICD specialist package
 * (src/specialists/packages/icd/index.ts "INTERFACE CATEGORIES"). Questions
 * carry one tag in their bold title ("**Q1. [ELECTRICAL] ...**") and the
 * normalized topic lands on portal items as meta.topic.
 */
export const QUESTION_TOPICS = ['electrical', 'mechanical', 'controls-data', 'thermal'] as const;

export type QuestionTopic = (typeof QUESTION_TOPICS)[number];

/**
 * Maximum Open Questions entries the portal collects per document per turn.
 * Enforced by the runner's onQuestions hook; upstream producers should apply
 * capQuestionsPerDoc() so they share the same semantics.
 */
export const QUESTION_CAP_PER_DOC = 9;

/**
 * Caps a question list to QUESTION_CAP_PER_DOC entries per document.
 * Input order is preserved and IS the priority ranking: the parser returns
 * questions in document order, and the model ranks blocking questions first
 * in that order.
 *
 * @param questions - items in priority order (titles or portal item objects)
 * @returns at most QUESTION_CAP_PER_DOC items, original order
 */
export function capQuestionsPerDoc<T>(questions: readonly T[]): T[] {
  return questions.slice(0, QUESTION_CAP_PER_DOC);
}

export const OPEN_QUESTIONS_SECTION_RULES = `OPEN QUESTIONS SECTION (MANDATORY):
- Include a \`## Open Questions\` section listing ANY genuinely unresolved questions that need user input before this deliverable can be considered complete. Format each entry as a DECISION MEMO: a bold numbered HEADER line **Q1. [TOPIC] Short concise question** (the header line is only the question — see the header rule below), followed by labeled lines — BLUF: (one-sentence recommendation up front), Research findings: (what is already known from research, the project dossier, docs or baselines — cite source names), Main suggestion: (the recommended option and its trade-off), Alternatives: (each alternative option and its trade-off), Defer: (the cost/impact of deferring this decision). A legacy **Why it matters:** explanation is still parsed (it lands as background context) but new entries MUST use the labeled decision-memo format above.
- Each question's bold title line MUST begin with an ICD system tag in brackets chosen ONLY from [ELECTRICAL], [MECHANICAL], [CONTROLS-DATA], or [THERMAL] — the ICD system the question belongs to; if it genuinely spans several systems, tag it with the dominant one. Example title line: **Q3. [ELECTRICAL] <short question title>.** (the Qn numbering prefix is retained).
- The bold title line is ONLY the number, the topic tag and ONE question: **Qn. [TOPIC] <short question>** — at most 90 characters, one sentence, ending with "?". It MUST NOT carry an explanation, background, rationale, a parenthetical justification, a "because …" clause, or the candidate options; every explanation, background note, rationale and option belongs in the labeled lines BELOW the title (BLUF: / Research findings: / Main suggestion: / Alternatives: / Defer:), never on the title line. When the item is not literally a question, the title line is a noun-phrase or imperative title of at most 90 characters and the detail moves down into those labeled lines.
- Do NOT silently assume answers or invent default values for genuinely open items.
- If the user later provides answers (e.g. a "USER ANSWERS TO OPEN QUESTIONS" block in their prompt), EDIT the relevant sections of the document IN PLACE to reflect each answer, REMOVE the answered questions from the Open Questions section, and re-derive any affected downstream statements. Do NOT regenerate or rewrite the entire document from scratch, and do NOT include your reasoning or meta-commentary in the document.
- Questions the user explicitly defers or skips stay in the Open Questions section.
- When the prompt contains PREVIOUSLY ANSWERED context, treat those decisions as settled: do NOT re-ask, re-open, or restate them in the Open Questions section; only genuinely NEW unresolved items may appear there.
- Entries under a "## User Answers (Pending Incorporation)" section are user answers awaiting incorporation: apply them to the relevant sections IN PLACE, then delete that section.
- The Open Questions section MUST NOT exceed 9 entries. Prioritize genuinely BLOCKING questions (procurement blockers, safety thresholds, baseline conflicts) over informational ones.
- For a non-blocking unresolved item, prefer recording an explicitly-marked provisional value in the document body (clearly labeled PROVISIONAL with its basis) over adding a question.
- If nothing is genuinely unresolved, omit the Open Questions section entirely.`;
