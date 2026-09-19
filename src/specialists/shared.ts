/**
 * Instructions appended to every specialist's system prompt, instructing the
 * model to use fs_edit for changes to existing drafts and fs_write only for
 * initial creation. Kept here (not in cli/*) to preserve the I/O-agnostic
 * boundary required by AGENTS.md.
 */
export const SHARED_EDIT_INSTRUCTIONS = `

EDITING DISCIPLINE:
When the deliverable document already exists on disk, make changes using the fs_edit tool with targeted {old_text, new_text} edits — never rewrite the whole document via fs_write. Quote old_text verbatim from the document; it must match exactly once. Reason about what section to change and why before calling. Use fs_write only for the initial creation of a new deliverable file. If you need to restructure a large region, quote the full region as old_text and provide the replacement as new_text.`;
