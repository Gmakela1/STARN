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
  RoadmapPhase,
  Settings,
  SettingsUpdate,
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

  // Documents
  fetchDoc: (phaseId: string) => call<DocData>('GET', `/api/docs/${encodeURIComponent(phaseId)}`),
  saveDoc: (phaseId: string, content: string) =>
    call<{ path: string }>('PUT', `/api/docs/${encodeURIComponent(phaseId)}`, { content }),
  approveDoc: (phaseId: string) =>
    call<{ artifact: unknown }>('POST', `/api/docs/${encodeURIComponent(phaseId)}/approve`),

  // BOM & Trade Studies
  fetchBom: () => call<BomData>('GET', '/api/bom'),
  fetchTradeStudy: () => call<SubsystemTradeStudy[]>('GET', '/api/trade-study'),
  updateBomItem: (itemId: string, updates: Partial<Pick<BomItem, 'qty' | 'tracking' | 'status' | 'actualTotal'>>) =>
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
  listProviderModels: (id: string) =>
    call<{ models: string[] }>('GET', `/api/providers/${encodeURIComponent(id)}/models`),
  probeProvider: (id: string, model: string) =>
    call<{ ok: boolean; detail: string }>('POST', `/api/providers/${encodeURIComponent(id)}/probe`, { model })
};
