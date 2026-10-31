// Approved-content snapshot lookup for the revised-doc diff view.
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStateManager } from '../workspace/state.js';

/**
 * Finds the newest archived version of `docName` whose SHA-256 matches the
 * artifact's approvedContentHash. Scans `<projectPath>/.starn/versions/<docName>-*.md`
 * newest-first (filenames are chronologically sortable; see util/version-backup.ts).
 *
 * Inputs: projectPath (absolute), docName (basename without extension), sha256
 * (hex digest from stateManager.getState().artifacts, may be null/undefined).
 * Returns the backup file CONTENT (string), or null when no archived version
 * matches (nothing to diff against).
 */
export function findApprovedBackup(
  projectPath: string,
  docName: string,
  sha256: string | null | undefined
): string | null {
  if (!sha256) return null;
  const versionsDir = path.join(projectPath, '.starn', 'versions');
  if (!fs.existsSync(versionsDir)) return null;

  const backups = fs.readdirSync(versionsDir)
    .filter(f => f.startsWith(`${docName}-`) && f.endsWith('.md'))
    .sort()
    .reverse(); // newest-first

  for (const name of backups) {
    const full = path.join(versionsDir, name);
    if (ProjectStateManager.computeContentHash(projectPath, path.relative(projectPath, full)) === sha256) {
      return fs.readFileSync(full, 'utf-8');
    }
  }
  return null;
}
