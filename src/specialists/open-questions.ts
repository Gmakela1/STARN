/**
 * Shared Open Questions convention applied to every specialist document.
 * The section heading "## Open Questions" (numeric prefix optional) is the
 * canonical, parseable location for unresolved questions in any deliverable,
 * enabling the roadmap panel to flag documents and the pre-turn interview to
 * collect user answers for LLM incorporation.
 */
export const OPEN_QUESTIONS_SECTION_RULES = `OPEN QUESTIONS SECTION (MANDATORY):
- Include a \`## Open Questions\` section listing ANY genuinely unresolved questions that need user input before this deliverable can be considered complete. Format each as a numbered list item: **Q1. <short question title>.** <context and what is not yet confirmed>, followed by a **Why it matters:** explanation.
- Do NOT silently assume answers or invent default values for genuinely open items.
- If the user later provides answers (e.g. a "USER ANSWERS TO OPEN QUESTIONS" block in their prompt), EDIT the relevant sections of the document IN PLACE to reflect each answer, REMOVE the answered questions from the Open Questions section, and re-derive any affected downstream statements. Do NOT regenerate or rewrite the entire document from scratch, and do NOT include your reasoning or meta-commentary in the document.
- Questions the user explicitly defers or skips stay in the Open Questions section.
- If nothing is genuinely unresolved, omit the Open Questions section entirely.`;
