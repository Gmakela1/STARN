import {
  ApiEnvelope,
  BomData,
  BomItem,
  CheckpointDecisionResult,
  DashboardData,
  DocData,
  IssuesSummary,
  PendingCheckpoint,
  ProjectInfo,
  ProjectIssue,
  ProjectsResponse,
  FolderListingResponse,
  LibraryListing,
  RoadmapPhase,
  Settings,
  SettingsUpdate,
  SearchSettings,
  SearchProvider,
  SubsystemTradeStudy,
  WorkInstruction
} from '../types/api';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const envelope = (await res.json()) as ApiEnvelope<T>;
  if (!envelope.success) {
    throw new Error(envelope.error ?? `Request failed: ${method} ${path}`);
  }
  return envelope.data as T;
}

export const api = {
  // Project & dashboard
  fetchProject: () => call<ProjectInfo>('GET', '/api/project'),
  fetchDashboard: () => call<DashboardData>('GET', '/api/dashboard'),
  fetchRoadmap: () => call<RoadmapPhase[]>('GET', '/api/roadmap'),

  // Workflow & Active Phase
  setActivePhase: (phaseId: string) =>
    call<{ activePhase: string }>('POST', '/api/workflow/active-phase', { phaseId }),

  // Documents
  fetchDoc: (phaseId: string) => call<DocData>('GET', `/api/docs/${encodeURIComponent(phaseId)}`),
  saveDoc: (phaseId: string, content: string) =>
    call<{ path: string }>('PUT', `/api/docs/${encodeURIComponent(phaseId)}`, { content }),
  approveDoc: (phaseId: string) =>
    call<{ artifact: unknown }>('POST', `/api/docs/${encodeURIComponent(phaseId)}/approve`),

  // BOM & Trade Studies
  fetchBom: () => call<BomData>('GET', '/api/bom'),
  fetchTradeStudy: () => call<SubsystemTradeStudy[]>('GET', '/api/trade-study'),
  updateBomItem: (itemId: string, updates: Partial<BomItem>) =>
    call<BomData>('PATCH', `/api/bom/items/${encodeURIComponent(itemId)}`, updates),

  // Actions / work instructions
  fetchActions: () => call<WorkInstruction[]>('GET', '/api/actions'),
  fetchAction: (actionId: string) => call<WorkInstruction>('GET', `/api/actions/${encodeURIComponent(actionId)}`),
  toggleActionStep: (actionId: string, stepIndex: number, checked: boolean) =>
    call<WorkInstruction>('PATCH', `/api/actions/${encodeURIComponent(actionId)}/checklist`, { stepIndex, checked }),

  // Issues
  fetchIssues: () => call<IssuesSummary>('GET', '/api/issues'),
  pushIssueToAgent: (issueId: string) =>
    call<{ prompt: string; issue: ProjectIssue }>('POST', `/api/issues/${encodeURIComponent(issueId)}/push-to-agent`),

  // Checkpoints
  fetchPendingCheckpoint: () => call<PendingCheckpoint | null>('GET', '/api/checkpoints/pending'),
  submitCheckpointDecision: (decision: 'approve' | 'revise' | 'discard', feedback?: string) =>
    call<CheckpointDecisionResult>('POST', '/api/checkpoints/decision', { decision, feedback }),

  // Turn control
  abortTurn: () => call<{ aborted: boolean }>('POST', '/api/turns/abort'),

  // Artifacts
  uploadArtifact: async (filename: string, file: Blob): Promise<{ path: string }> => {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return call<{ path: string }>('POST', '/api/artifacts/upload', {
      filename,
      contentBase64: btoa(binary)
    });
  },
  artifactUrl: (filename: string) => `/api/artifacts/${encodeURIComponent(filename)}`,

  // Settings
  fetchSettings: () => call<Settings>('GET', '/api/settings'),
  saveSettings: (update: SettingsUpdate) => call<Settings>('PUT', '/api/settings', update),
  fetchSearchSettings: () => call<SearchSettings>('GET', '/api/settings/search'),
  saveSearchSettings: (updates: { provider?: SearchProvider; tavilyApiKey?: string; braveApiKey?: string }) =>
    call<SearchSettings>('POST', '/api/settings/search', updates),
  probeSearchProvider: (body: { provider?: SearchProvider; apiKey?: string }) =>
    call<{ success: boolean; provider: string; latencyMs: number; error?: string }>('POST', '/api/settings/search/probe', body),
  listProviderModels: (id: string) =>
    call<{ models: string[] }>('GET', `/api/providers/${encodeURIComponent(id)}/models`),
  probeProvider: (id: string, model: string) =>
    call<{ ok: boolean; detail: string }>('POST', `/api/providers/${encodeURIComponent(id)}/probe`, { model }),

  // Library & File Uploads
  uploadExample: async (specialistId: string, filename: string, file: Blob): Promise<{ path: string; filename: string }> => {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return call<{ path: string; filename: string }>('POST', `/api/examples/${encodeURIComponent(specialistId)}`, {
      filename,
      contentBase64: btoa(binary)
    });
  },
  uploadReference: async (filename: string, file: Blob): Promise<{ path: string; filename: string }> => {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return call<{ path: string; filename: string }>('POST', '/api/references', {
      filename,
      contentBase64: btoa(binary)
    });
  },
  fetchLibrary: () => call<LibraryListing>('GET', '/api/library'),
  deleteReference: (name: string) => call<{ success: boolean }>('DELETE', `/api/library/references/${encodeURIComponent(name)}`),
  deleteExample: (specialistId: string, name: string) =>
    call<{ success: boolean }>('DELETE', `/api/library/examples/${encodeURIComponent(specialistId)}/${encodeURIComponent(name)}`),

  // Projects & Filesystem
  fetchProjects: () => call<ProjectsResponse>('GET', '/api/projects'),
  browseFolders: (dirPath?: string, q?: string) => {
    const params = new URLSearchParams();
    if (dirPath) params.set('path', dirPath);
    if (q) params.set('q', q);
    const query = params.toString();
    return call<FolderListingResponse>('GET', `/api/fs/folders${query ? `?${query}` : ''}`);
  },
  switchProject: (body: { projectId?: string; path?: string }) =>
    call<ProjectInfo>('POST', '/api/projects/switch', body)
};
