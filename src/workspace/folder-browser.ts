import fs from 'node:fs';
import path from 'node:path';

export interface FolderEntry {
  name: string;
  path: string;
  isProject: boolean;
}

export interface FolderListing {
  currentPath: string;
  parentPath: string | null;
  folders: FolderEntry[];
}

/**
 * Lists visible subdirectories in `targetDir` that are candidate project folders.
 * Skips hidden folders (`.*`), `node_modules`, and `dist`.
 * Identifies STARN projects by checking for the existence of `.starn/`.
 */
export function listFolders(targetDir: string, query?: string): FolderListing {
  const resolved = path.resolve(targetDir);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory does not exist: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`);
  }

  const parent = path.dirname(resolved);
  const parentPath = parent === resolved ? null : parent;

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (err: any) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      return {
        currentPath: resolved,
        parentPath,
        folders: []
      };
    }
    throw err;
  }

  const folders: FolderEntry[] = [];
  const lowerQuery = query ? query.trim().toLowerCase() : null;

  for (const entry of entries) {
    try {
      if (!entry.isDirectory()) continue;
    } catch {
      continue;
    }

    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('$')) continue;
    if (entry.name.toLowerCase() === 'system volume information') continue;
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;

    if (lowerQuery && !entry.name.toLowerCase().includes(lowerQuery)) {
      continue;
    }

    const folderPath = path.join(resolved, entry.name);
    let isProject = false;
    try {
      isProject = fs.existsSync(path.join(folderPath, '.starn'));
    } catch {
      isProject = false;
    }

    folders.push({
      name: entry.name,
      path: folderPath,
      isProject
    });
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));

  return {
    currentPath: resolved,
    parentPath,
    folders
  };
}
