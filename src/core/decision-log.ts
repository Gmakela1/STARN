import fs from 'node:fs';
import path from 'node:path';

// Decision Log Harvest (moved verbatim from cli/checkpoint.ts — I/O-agnostic core
// so every approval path — CLI checkpoint, web resolveCheckpoint, web
// /api/docs/:id/approve, autopilot — preserves DECISIONS.md extraction).
const DESIGN_DECISIONS_HEADER = '## Design Decisions';

/**
 * Extracts the Design Decisions section from a document and appends it to docs/DECISIONS.md.
 * Idempotent: checks for duplicate D-XXX IDs before appending.
 * Returns the number of new entries appended.
 */
export function harvestDecisionLog(projectPath: string, specialistId: string): number {
  const docName = `${specialistId.toUpperCase()}.md`;
  const docPath = path.join(projectPath, 'docs', docName);
  const decisionsPath = path.join(projectPath, 'docs', 'DECISIONS.md');

  if (!fs.existsSync(docPath)) return 0;

  const docContent = fs.readFileSync(docPath, 'utf-8');
  const headerIndex = docContent.indexOf(DESIGN_DECISIONS_HEADER);
  if (headerIndex === -1) return 0;

  // Extract everything from the Design Decisions header to the next top-level header or end
  const afterHeader = docContent.slice(headerIndex + DESIGN_DECISIONS_HEADER.length);
  const nextHeaderMatch = afterHeader.match(/\n## /);
  const decisionsSection = nextHeaderMatch
    ? afterHeader.slice(0, nextHeaderMatch.index)
    : afterHeader;

  const trimmedSection = decisionsSection.trim();
  if (!trimmedSection) return 0;

  // Extract all D-XXX or D-XXX IDs from the section
  const idRegex = /D-\d+/g;
  const newIds: string[] = trimmedSection.match(idRegex) || [];
  if (newIds.length === 0) return 0;

  // Read existing DECISIONS.md if it exists
  let existingContent = '';
  if (fs.existsSync(decisionsPath)) {
    existingContent = fs.readFileSync(decisionsPath, 'utf-8');
  }

  // Check for duplicates — skip if any entry already exists
  const existingIds: string[] = existingContent.match(/D-\d+/g) || [];
  const alreadyExists = newIds.some(id => existingIds.includes(id));
  if (alreadyExists) {
    return 0; // idempotent — skip if any entry already exists
  }

  // Append the entries (no duplicate header)
  const entry = `\n${trimmedSection}`;
  fs.writeFileSync(decisionsPath, existingContent + entry, 'utf-8');

  return newIds.length;
}