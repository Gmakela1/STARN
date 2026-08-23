import fs from 'node:fs';
import path from 'node:path';
import { ProjectStateManager } from '../workspace/state.js';

export interface DiscoverySummary {
  existingFiles: string[];
  existingArtifacts: string[];
  discoveryText: string;
}

export async function runDiscovery(projectPath: string, stateManager: ProjectStateManager): Promise<DiscoverySummary> {
  const root = path.resolve(projectPath);
  const foundFiles: string[] = [];

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name === '.git' || item.name === 'node_modules' || item.name === '.starn') continue;
      const full = path.join(dir, item.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (item.isDirectory()) {
        scanDir(full);
      } else {
        foundFiles.push(rel);
      }
    }
  }

  scanDir(root);

  const state = stateManager.getState();
  const existingArtifacts = state.artifacts.map(a => `${a.title} (${a.path}) - ${a.status}`);

  let discoveryText = `PROJECT DISCOVERY BRIEFING:\n`;
  discoveryText += `- Project Name: ${state.name}\n`;
  discoveryText += `- Current Phase: ${state.currentPhase}\n`;
  discoveryText += `- Existing Files in Workspace:\n  ${foundFiles.length > 0 ? foundFiles.map(f => `* ${f}`).join('\n  ') : '(None)'}\n`;
  discoveryText += `- Approved/Existing Artifacts:\n  ${existingArtifacts.length > 0 ? existingArtifacts.map(a => `* ${a}`).join('\n  ') : '(None)'}\n`;
  if (state.openRisks.length > 0) {
    discoveryText += `- Open Risks:\n  ${state.openRisks.map(r => `* ${r}`).join('\n  ')}\n`;
  }

  stateManager.updateDiscoverySummary(discoveryText, state.discovery.keyConstraints);

  return {
    existingFiles: foundFiles,
    existingArtifacts,
    discoveryText
  };
}
