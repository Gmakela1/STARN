import fs from 'node:fs';
import path from 'node:path';

const MAX_VERSIONS_PER_DOC = 10;

/**
 * Copies the current contents of `filePath` to a timestamped backup under
 * `<projectPath>/.starn/versions/`. Prunes to the MAX_VERSIONS_PER_DOC most
 * recent backups for that doc name. Returns the backup path, or null if the
 * source file does not exist (e.g. initial creation — nothing to back up).
 *
 * Timestamp format is filesystem-safe ISO 8601 (colons replaced with dashes)
 * so the same name sorts chronologically and is safe on Windows.
 */
export function createVersionBackup(projectPath: string, filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const versionsDir = path.join(projectPath, '.starn', 'versions');
  if (!fs.existsSync(versionsDir)) {
    fs.mkdirSync(versionsDir, { recursive: true });
  }

  const docName = path.basename(filePath, path.extname(filePath));
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const backupPath = path.join(versionsDir, `${docName}-${timestamp}.md`);

  fs.copyFileSync(filePath, backupPath);

  // Prune: keep only the MAX_VERSIONS_PER_DOC most recent for this doc name.
  const all = fs.readdirSync(versionsDir)
    .filter(f => f.startsWith(`${docName}-`) && f.endsWith('.md'))
    .sort(); // ISO-safe names sort chronologically
  if (all.length > MAX_VERSIONS_PER_DOC) {
    const toDelete = all.slice(0, all.length - MAX_VERSIONS_PER_DOC);
    for (const f of toDelete) {
      fs.unlinkSync(path.join(versionsDir, f));
    }
  }

  return backupPath;
}
