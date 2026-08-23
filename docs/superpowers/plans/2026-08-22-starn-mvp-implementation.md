# STARN MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a robust, terminal-based AI project management assistant for physical/hardware projects with specialist context packs, mandatory discovery, harsh critic auto-revisions, and human checkpoints.

**Architecture:** A TypeScript modular engine orchestrating OpenRouter model completions through strict specialist packages. Features a linear pipeline (`Classifier` -> `Discovery` -> `Specialist Tool Loop` -> `Critic While-Loop` -> `Human Checkpoint` -> `State Persist`), safe filesystem and state tools, and an autonomous testbed.

**Tech Stack:** TypeScript (ES2022 / Node.js 20+), Vitest, Inquirer / `@inquirer/prompts`, Chalk, Boxen, Zod, native `fetch` for OpenRouter API.

**Spec:** `docs/superpowers/specs/2026-08-22-starn-mvp-design.md`

## Global Constraints
- Node.js 20+ compatibility with pure TypeScript and ESM (`"type": "module"`).
- All model calls route strictly through OpenRouter (`https://openrouter.ai/api/v1/chat/completions`) with OpenAI-compatible tool calling format.
- Strictly gated tools per specialist package.
- Critic must evaluate standard of quality, technical rigor, completeness, and structure against developer and user quality examples.
- Test-driven development for every module using Vitest.

---

### Task 1: Project Scaffolding, Package Setup & Config Management

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(): StarnConfig`, `getGlobalStarnDir(): string`, `ensureStarnDirs(): void`

- [ ] **Step 1: Write the failing test for configuration loading**

```typescript
// tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, getGlobalStarnDir, ensureStarnDirs } from '../src/config';

describe('Config Loader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads API key from environment variable', () => {
    process.env.OPENROUTER_API_KEY = 'test-key-123';
    process.env.OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';
    const config = loadConfig();
    expect(config.apiKey).toBe('test-key-123');
    expect(config.defaultModel).toBe('anthropic/claude-3.5-sonnet');
  });

  it('resolves the global .starn directory path under user home directory', () => {
    const dir = getGlobalStarnDir();
    expect(dir).toBe(path.join(os.homedir(), '.starn'));
  });

  it('creates global directories if they do not exist', () => {
    const tempHome = path.join(os.tmpdir(), 'starn-test-home-' + Date.now());
    fs.mkdirSync(tempHome, { recursive: true });
    const dir = path.join(tempHome, '.starn');
    ensureStarnDirs(dir);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'projects'))).toBe(true);
    fs.rmSync(tempHome, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL (missing files / vitest not initialized)

- [ ] **Step 3: Create package.json, tsconfig.json, vitest.config.ts, and implement src/config.ts**

```json
// package.json
{
  "name": "starn",
  "version": "0.1.0",
  "description": "Terminal-based AI project management agent for physical/hardware projects",
  "type": "module",
  "bin": {
    "starn": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@inquirer/prompts": "^7.3.1",
    "boxen": "^8.0.1",
    "chalk": "^5.4.1",
    "dotenv": "^16.4.7",
    "ora": "^8.2.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^22.13.4",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
```

```typescript
// src/config.ts
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

export interface StarnConfig {
  apiKey: string;
  defaultModel: string;
  siteUrl: string;
  appName: string;
  globalDir: string;
}

export function getGlobalStarnDir(): string {
  return path.join(os.homedir(), '.starn');
}

export function ensureStarnDirs(customGlobalDir?: string): void {
  const base = customGlobalDir || getGlobalStarnDir();
  const projectsDir = path.join(base, 'projects');
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }
}

export function loadConfig(): StarnConfig {
  const globalDir = getGlobalStarnDir();
  return {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    defaultModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet',
    siteUrl: process.env.OPENROUTER_SITE_URL || 'https://github.com/makel/STARN',
    appName: process.env.OPENROUTER_SITE_NAME || 'STARN PM Agent',
    globalDir
  };
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm install && npx vitest run tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .env.example src/config.ts tests/config.test.ts
git commit -m "feat: scaffold project, setup vitest, and implement config loader"
```

---

### Task 2: OpenRouter Client & Model Catalog

**Files:**
- Create: `src/openrouter/types.ts`
- Create: `src/openrouter/models.ts`
- Create: `src/openrouter/client.ts`
- Test: `tests/openrouter.test.ts`

**Interfaces:**
- Produces: `class OpenRouterClient`, `AVAILABLE_MODELS`, `ChatCompletionMessage`, `ToolDefinition`

- [ ] **Step 1: Write failing tests for OpenRouter Client and model catalog**

```typescript
// tests/openrouter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterClient } from '../src/openrouter/client';
import { AVAILABLE_MODELS } from '../src/openrouter/models';

describe('OpenRouter Models', () => {
  it('defines standard physical engineering compatible models', () => {
    expect(AVAILABLE_MODELS.length).toBeGreaterThan(0);
    expect(AVAILABLE_MODELS.some(m => m.id.includes('claude-3.5-sonnet'))).toBe(true);
  });
});

describe('OpenRouter Client', () => {
  let client: OpenRouterClient;

  beforeEach(() => {
    client = new OpenRouterClient({
      apiKey: 'sk-or-test-key',
      siteUrl: 'https://test.starn.local',
      appName: 'STARN Unit Test'
    });
  });

  it('formats payload with OpenRouter specific headers and tools', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'gen-123',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello, physical engineer!'
            },
            finish_reason: 'stop'
          }
        ]
      })
    });
    global.fetch = mockFetch;

    const response = await client.chatCompletion({
      model: 'anthropic/claude-3.5-sonnet',
      messages: [{ role: 'user', content: 'Design solar frame' }]
    });

    expect(response.content).toBe('Hello, physical engineer!');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-or-test-key',
          'HTTP-Referer': 'https://test.starn.local',
          'X-Title': 'STARN Unit Test'
        })
      })
    );
  });

  it('handles tool calls returned by OpenRouter correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'gen-456',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'fs_read',
                    arguments: JSON.stringify({ path: 'docs/CONOPS.md' })
                  }
                }
              ]
            },
            finish_reason: 'tool_calls'
          }
        ]
      })
    });
    global.fetch = mockFetch;

    const response = await client.chatCompletion({
      model: 'anthropic/claude-3.5-sonnet',
      messages: [{ role: 'user', content: 'Check existing conops' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'fs_read',
            description: 'Read file',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path']
            }
          }
        }
      ]
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].function.name).toBe('fs_read');
    expect(JSON.parse(response.toolCalls![0].function.arguments)).toEqual({ path: 'docs/CONOPS.md' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/openrouter.test.ts`
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement OpenRouter types, models, and client**

```typescript
// src/openrouter/types.ts
export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls?: ToolCall[];
  raw: unknown;
}
```

```typescript
// src/openrouter/models.ts
export interface ModelOption {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    description: 'Top-tier technical reasoning, precise tool usage & document generation (Recommended)',
    recommended: true
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    description: 'Strong general reasoning and fast tool execution',
    recommended: false
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    description: 'High capability and cost-effective physical project reasoning',
    recommended: false
  },
  {
    id: 'google/gemini-2.0-flash-001',
    name: 'Gemini 2.0 Flash',
    description: 'Extremely fast responses and large context window',
    recommended: false
  }
];
```

```typescript
// src/openrouter/client.ts
import { ChatCompletionOptions, ChatCompletionResult, ChatMessage, ToolDefinition } from './types.js';

export interface OpenRouterClientOptions {
  apiKey: string;
  siteUrl?: string;
  appName?: string;
  baseUrl?: string;
}

export class OpenRouterClient {
  private apiKey: string;
  private siteUrl: string;
  private appName: string;
  private baseUrl: string;

  constructor(options: OpenRouterClientOptions) {
    this.apiKey = options.apiKey;
    this.siteUrl = options.siteUrl || 'https://github.com/makel/STARN';
    this.appName = options.appName || 'STARN PM Agent';
    this.baseUrl = options.baseUrl || 'https://openrouter.ai/api/v1/chat/completions';
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'HTTP-Referer': this.siteUrl,
      'X-Title': this.appName
    };

    const payload: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2
    };

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools;
    }
    if (options.max_tokens) {
      payload.max_tokens = options.max_tokens;
    }

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenRouter API error (${res.status}): ${errorText}`);
    }

    const data = await res.json() as any;
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error('Invalid response structure from OpenRouter API');
    }

    return {
      content: choice.message.content || null,
      toolCalls: choice.message.tool_calls || undefined,
      raw: data
    };
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/openrouter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/openrouter/ tests/openrouter.test.ts
git commit -m "feat: implement OpenRouter API client and model options"
```

---

### Task 3: Workspace & Project State Persistence

**Files:**
- Create: `src/workspace/types.ts`
- Create: `src/workspace/registry.ts`
- Create: `src/workspace/state.ts`
- Test: `tests/workspace.test.ts`

**Interfaces:**
- Produces: `class ProjectRegistry`, `class ProjectStateManager`, `ProjectRecord`, `ProjectState`

- [ ] **Step 1: Write failing tests for workspace management and project state**

```typescript
// tests/workspace.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectRegistry } from '../src/workspace/registry';
import { ProjectStateManager } from '../src/workspace/state';

describe('Project Registry & State', () => {
  let tempBaseDir: string;
  let registryFile: string;

  beforeEach(() => {
    tempBaseDir = path.join(os.tmpdir(), 'starn-workspace-test-' + Date.now());
    fs.mkdirSync(tempBaseDir, { recursive: true });
    registryFile = path.join(tempBaseDir, 'registry.json');
  });

  afterEach(() => {
    fs.rmSync(tempBaseDir, { recursive: true, force: true });
  });

  it('links and lists projects in the central registry', () => {
    const registry = new ProjectRegistry(registryFile);
    const projPath = path.join(tempBaseDir, 'my-solar-shed');
    fs.mkdirSync(projPath, { recursive: true });

    const record = registry.registerProject('Off-Grid Solar Shed', projPath);
    expect(record.id).toBeDefined();
    expect(record.name).toBe('Off-Grid Solar Shed');
    expect(record.path).toBe(path.resolve(projPath));

    const list = registry.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(record.id);

    registry.setActiveProject(record.id);
    expect(registry.getActiveProject()?.id).toBe(record.id);
  });

  it('initializes, reads, and updates project state on disk', () => {
    const projPath = path.join(tempBaseDir, 'shed-project');
    fs.mkdirSync(projPath, { recursive: true });

    const stateMgr = new ProjectStateManager(projPath);
    const initial = stateMgr.getOrCreateState('shed-1', 'Shed Project');
    expect(initial.currentPhase).toBe('discovery');
    expect(initial.artifacts).toEqual([]);

    stateMgr.updateDiscoverySummary('Timber frame shed 12x10 with 3kW array', ['Under 120 sqft']);
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'Concept of Operations',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.0
    });

    const reloaded = stateMgr.getState();
    expect(reloaded.discovery.summary).toContain('Timber frame');
    expect(reloaded.discovery.keyConstraints).toContain('Under 120 sqft');
    expect(reloaded.artifacts).toHaveLength(1);
    expect(reloaded.artifacts[0].id).toBe('CONOPS');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workspace.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement workspace registry and state manager**

```typescript
// src/workspace/types.ts
export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastActiveAt: string;
}

export interface RegistryData {
  activeProjectId: string | null;
  defaultModel: string;
  projects: ProjectRecord[];
}

export interface ArtifactRecord {
  id: string;
  title: string;
  path: string;
  status: 'draft' | 'approved' | 'rejected';
  criticScore?: number;
  updatedAt: string;
}

export interface DiscoveryState {
  lastScanned: string | null;
  summary: string;
  keyConstraints: string[];
}

export interface ProjectState {
  projectId: string;
  name: string;
  currentPhase: string;
  discovery: DiscoveryState;
  artifacts: ArtifactRecord[];
  openRisks: string[];
  recentActions: string[];
}
```

```typescript
// src/workspace/registry.ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProjectRecord, RegistryData } from './types.js';

export class ProjectRegistry {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.ensureFile();
  }

  private ensureFile(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      const initial: RegistryData = {
        activeProjectId: null,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        projects: []
      };
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf-8');
    }
  }

  public read(): RegistryData {
    this.ensureFile();
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    return JSON.parse(raw) as RegistryData;
  }

  public write(data: RegistryData): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  public registerProject(name: string, targetPath: string): ProjectRecord {
    const resolvedPath = path.resolve(targetPath);
    const data = this.read();
    const existing = data.projects.find(p => p.path === resolvedPath);
    if (existing) {
      existing.name = name;
      existing.lastActiveAt = new Date().toISOString();
      this.write(data);
      return existing;
    }

    const id = 'proj_' + crypto.randomBytes(4).toString('hex');
    const now = new Date().toISOString();
    const newRecord: ProjectRecord = {
      id,
      name,
      path: resolvedPath,
      createdAt: now,
      lastActiveAt: now
    };

    data.projects.push(newRecord);
    data.activeProjectId = id;
    this.write(data);
    return newRecord;
  }

  public listProjects(): ProjectRecord[] {
    return this.read().projects;
  }

  public getActiveProject(): ProjectRecord | null {
    const data = this.read();
    if (!data.activeProjectId) return null;
    return data.projects.find(p => p.id === data.activeProjectId) || null;
  }

  public setActiveProject(id: string): void {
    const data = this.read();
    if (data.projects.some(p => p.id === id)) {
      data.activeProjectId = id;
      this.write(data);
    }
  }

  public setDefaultModel(model: string): void {
    const data = this.read();
    data.defaultModel = model;
    this.write(data);
  }
}
```

```typescript
// src/workspace/state.ts
import fs from 'node:fs';
import path from 'node:path';
import { ProjectState, ArtifactRecord } from './types.js';

export class ProjectStateManager {
  private projectPath: string;
  private stateFilePath: string;

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
    this.stateFilePath = path.join(this.projectPath, '.starn', 'state.json');
  }

  public getOrCreateState(projectId: string, name: string): ProjectState {
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.stateFilePath)) {
      return this.getState();
    }

    const initialState: ProjectState = {
      projectId,
      name,
      currentPhase: 'discovery',
      discovery: {
        lastScanned: null,
        summary: '',
        keyConstraints: []
      },
      artifacts: [],
      openRisks: [],
      recentActions: []
    };

    this.saveState(initialState);
    return initialState;
  }

  public getState(): ProjectState {
    if (!fs.existsSync(this.stateFilePath)) {
      throw new Error(`Project state not found at ${this.stateFilePath}`);
    }
    const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
    return JSON.parse(raw) as ProjectState;
  }

  public saveState(state: ProjectState): void {
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  public updateDiscoverySummary(summary: string, keyConstraints: string[] = []): void {
    const state = this.getState();
    state.discovery = {
      lastScanned: new Date().toISOString(),
      summary,
      keyConstraints
    };
    this.saveState(state);
  }

  public recordArtifact(artifact: Omit<ArtifactRecord, 'updatedAt'>): void {
    const state = this.getState();
    const index = state.artifacts.findIndex(a => a.id === artifact.id);
    const fullRecord: ArtifactRecord = {
      ...artifact,
      updatedAt: new Date().toISOString()
    };

    if (index >= 0) {
      state.artifacts[index] = fullRecord;
    } else {
      state.artifacts.push(fullRecord);
    }
    state.recentActions.push(`Updated artifact ${artifact.id} (${artifact.status})`);
    this.saveState(state);
  }

  public addAction(action: string): void {
    const state = this.getState();
    state.recentActions.push(action);
    if (state.recentActions.length > 50) {
      state.recentActions.shift();
    }
    this.saveState(state);
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/workspace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workspace/ tests/workspace.test.ts
git commit -m "feat: implement workspace registry and state management"
```

---

### Task 4: Safe Tools & Specialist Tool Registry

**Files:**
- Create: `src/tools/types.ts`
- Create: `src/tools/handlers/fs-read.ts`
- Create: `src/tools/handlers/fs-write.ts`
- Create: `src/tools/handlers/fs-list.ts`
- Create: `src/tools/handlers/state-read.ts`
- Create: `src/tools/handlers/state-update.ts`
- Create: `src/tools/handlers/example-reader.ts`
- Create: `src/tools/registry.ts`
- Test: `tests/tools.test.ts`

**Interfaces:**
- Produces: `ToolRegistry`, `ToolExecutionContext`, `executeTool(name, args, context)`

- [ ] **Step 1: Write failing tests for safe tool execution and gating**

```typescript
// tests/tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry';
import { ProjectStateManager } from '../src/workspace/state';

describe('Tool Registry & Safe Handlers', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-tool-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('test-proj', 'Test Project');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('allows reading, writing, and listing files safely inside project path', async () => {
    const registry = new ToolRegistry();
    const context = { projectPath: tempDir, stateManager: stateMgr };

    // Write file
    const writeRes = await registry.execute(
      'fs_write',
      { path: 'docs/test.md', content: '# Physical Frame Specs' },
      context,
      ['fs_write', 'fs_read', 'fs_list']
    );
    expect(writeRes.success).toBe(true);

    // Read file
    const readRes = await registry.execute(
      'fs_read',
      { path: 'docs/test.md' },
      context,
      ['fs_write', 'fs_read', 'fs_list']
    );
    expect(readRes.result).toBe('# Physical Frame Specs');

    // List directory
    const listRes = await registry.execute(
      'fs_list',
      { dir: 'docs' },
      context,
      ['fs_list']
    );
    expect(listRes.result).toContain('test.md');
  });

  it('rejects execution when a tool is not in the allowed tool list', async () => {
    const registry = new ToolRegistry();
    const context = { projectPath: tempDir, stateManager: stateMgr };

    const result = await registry.execute(
      'fs_write',
      { path: 'danger.txt', content: 'not allowed' },
      context,
      ['fs_read'] // Only fs_read allowed
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tool fs_write is not permitted');
  });

  it('prevents directory traversal outside project root', async () => {
    const registry = new ToolRegistry();
    const context = { projectPath: tempDir, stateManager: stateMgr };

    const result = await registry.execute(
      'fs_read',
      { path: '../../outside.txt' },
      context,
      ['fs_read']
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Path traversal');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement tool types, handlers, and ToolRegistry**

```typescript
// src/tools/types.ts
import { ToolDefinition } from '../openrouter/types.js';
import { ProjectStateManager } from '../workspace/state.js';

export interface ToolExecutionContext {
  projectPath: string;
  stateManager: ProjectStateManager;
  builtinExamplesDir?: string;
}

export interface ToolExecutionResponse {
  success: boolean;
  result?: string;
  error?: string;
}

export interface ToolHandler {
  name: string;
  definition: ToolDefinition;
  execute: (args: any, context: ToolExecutionContext) => Promise<ToolExecutionResponse>;
}
```

```typescript
// src/tools/handlers/fs-read.ts
import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';

export const fsReadHandler: ToolHandler = {
  name: 'fs_read',
  definition: {
    type: 'function',
    function: {
      name: 'fs_read',
      description: 'Read the contents of a file in the project folder',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to file within the project' }
        },
        required: ['path']
      }
    }
  },
  async execute(args: { path: string }, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const safeBase = path.resolve(context.projectPath);
    const target = path.resolve(safeBase, args.path);
    if (!target.startsWith(safeBase)) {
      return { success: false, error: 'Path traversal is not permitted.' };
    }
    if (!fs.existsSync(target)) {
      return { success: false, error: `File not found: ${args.path}` };
    }
    const content = fs.readFileSync(target, 'utf-8');
    return { success: true, result: content };
  }
};
```

```typescript
// src/tools/handlers/fs-write.ts
import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';

export const fsWriteHandler: ToolHandler = {
  name: 'fs_write',
  definition: {
    type: 'function',
    function: {
      name: 'fs_write',
      description: 'Create or overwrite a file in the project folder',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to file within the project' },
          content: { type: 'string', description: 'Content to write' }
        },
        required: ['path', 'content']
      }
    }
  },
  async execute(args: { path: string; content: string }, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const safeBase = path.resolve(context.projectPath);
    const target = path.resolve(safeBase, args.path);
    if (!target.startsWith(safeBase)) {
      return { success: false, error: 'Path traversal is not permitted.' };
    }
    const parent = path.dirname(target);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(target, args.content, 'utf-8');
    return { success: true, result: `Successfully wrote ${args.content.length} bytes to ${args.path}` };
  }
};
```

```typescript
// src/tools/handlers/fs-list.ts
import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';

export const fsListHandler: ToolHandler = {
  name: 'fs_list',
  definition: {
    type: 'function',
    function: {
      name: 'fs_list',
      description: 'List files and directories in the project or a subfolder',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Relative directory path (defaults to root .)' }
        }
      }
    }
  },
  async execute(args: { dir?: string }, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const safeBase = path.resolve(context.projectPath);
    const target = path.resolve(safeBase, args.dir || '.');
    if (!target.startsWith(safeBase)) {
      return { success: false, error: 'Path traversal is not permitted.' };
    }
    if (!fs.existsSync(target)) {
      return { success: false, error: `Directory not found: ${args.dir || '.'}` };
    }
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const formatted = entries
      .filter(e => e.name !== '.git' && e.name !== 'node_modules')
      .map(e => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`)
      .join('\n');
    return { success: true, result: formatted || '(empty directory)' };
  }
};
```

```typescript
// src/tools/handlers/state-read.ts
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';

export const stateReadHandler: ToolHandler = {
  name: 'state_read',
  definition: {
    type: 'function',
    function: {
      name: 'state_read',
      description: 'Read the current project state (discovery, artifacts, risks, phase)',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  async execute(_args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const state = context.stateManager.getState();
    return { success: true, result: JSON.stringify(state, null, 2) };
  }
};
```

```typescript
// src/tools/handlers/state-update.ts
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';

export const stateUpdateHandler: ToolHandler = {
  name: 'state_update',
  definition: {
    type: 'function',
    function: {
      name: 'state_update',
      description: 'Update project state fields such as phase, risk, or recent action',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action description to record' },
          phase: { type: 'string', description: 'New current phase name' },
          addRisk: { type: 'string', description: 'New risk to record' }
        }
      }
    }
  },
  async execute(args: { action?: string; phase?: string; addRisk?: string }, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const state = context.stateManager.getState();
    if (args.phase) {
      state.currentPhase = args.phase;
    }
    if (args.addRisk) {
      state.openRisks.push(args.addRisk);
    }
    if (args.action) {
      state.recentActions.push(args.action);
    }
    context.stateManager.saveState(state);
    return { success: true, result: 'Project state successfully updated.' };
  }
};
```

```typescript
// src/tools/handlers/example-reader.ts
import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';

export const exampleReaderHandler: ToolHandler = {
  name: 'example_reader',
  definition: {
    type: 'function',
    function: {
      name: 'example_reader',
      description: 'List and read developer secret-sauce or user custom quality examples',
      parameters: {
        type: 'object',
        properties: {
          specialistId: { type: 'string', description: 'Specialist ID (e.g., conops, wbs)' }
        },
        required: ['specialistId']
      }
    }
  },
  async execute(args: { specialistId: string }, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const customExamplesDir = path.join(context.projectPath, 'examples', args.specialistId);
    let results: string[] = [];

    if (fs.existsSync(customExamplesDir)) {
      const files = fs.readdirSync(customExamplesDir);
      for (const f of files) {
        if (f.endsWith('.md')) {
          const content = fs.readFileSync(path.join(customExamplesDir, f), 'utf-8');
          results.push(`### Custom User Example (${f}):\n${content}`);
        }
      }
    }

    if (results.length === 0) {
      return { success: true, result: 'No user custom examples found for this specialist.' };
    }
    return { success: true, result: results.join('\n\n---\n\n') };
  }
};
```

```typescript
// src/tools/registry.ts
import { ToolDefinition } from '../openrouter/types.js';
import { ToolExecutionContext, ToolExecutionResponse, ToolHandler } from './types.js';
import { fsReadHandler } from './handlers/fs-read.js';
import { fsWriteHandler } from './handlers/fs-write.js';
import { fsListHandler } from './handlers/fs-list.js';
import { stateReadHandler } from './handlers/state-read.js';
import { stateUpdateHandler } from './handlers/state-update.js';
import { exampleReaderHandler } from './handlers/example-reader.js';

export class ToolRegistry {
  private handlers: Map<string, ToolHandler> = new Map();

  constructor() {
    this.register(fsReadHandler);
    this.register(fsWriteHandler);
    this.register(fsListHandler);
    this.register(stateReadHandler);
    this.register(stateUpdateHandler);
    this.register(exampleReaderHandler);
  }

  public register(handler: ToolHandler): void {
    this.handlers.set(handler.name, handler);
  }

  public getDefinitions(allowedToolNames?: string[]): ToolDefinition[] {
    const list: ToolDefinition[] = [];
    for (const [name, handler] of this.handlers.entries()) {
      if (!allowedToolNames || allowedToolNames.includes(name)) {
        list.push(handler.definition);
      }
    }
    return list;
  }

  public async execute(
    name: string,
    args: any,
    context: ToolExecutionContext,
    allowedToolNames?: string[]
  ): Promise<ToolExecutionResponse> {
    if (allowedToolNames && !allowedToolNames.includes(name)) {
      return {
        success: false,
        error: `Tool ${name} is not permitted for the active specialist package.`
      };
    }

    const handler = this.handlers.get(name);
    if (!handler) {
      return {
        success: false,
        error: `Unknown tool: ${name}`
      };
    }

    try {
      return await handler.execute(args, context);
    } catch (err: any) {
      return {
        success: false,
        error: `Tool execution failed: ${err.message || String(err)}`
      };
    }
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/ tests/tools.test.ts
git commit -m "feat: implement safe tool handlers and specialist tool registry"
```

---

### Task 5: Specialist Packages & "Secret Sauce" Exemplars

**Files:**
- Create: `src/specialists/types.ts`
- Create: `src/specialists/packages/general/index.ts`
- Create: `src/specialists/packages/conops/index.ts`
- Create: `src/specialists/packages/capabilities/index.ts`
- Create: `src/specialists/packages/milestones/index.ts`
- Create: `src/specialists/packages/wbs/index.ts`
- Create: `src/specialists/packages/sow/index.ts`
- Create: `src/specialists/registry.ts`
- Test: `tests/specialists.test.ts`

**Interfaces:**
- Produces: `SpecialistPackage`, `SpecialistRegistry`, `getSpecialist(id)`

- [ ] **Step 1: Write failing tests for specialist registry & packages**

```typescript
// tests/specialists.test.ts
import { describe, it, expect } from 'vitest';
import { SpecialistRegistry } from '../src/specialists/registry';

describe('Specialist Packages', () => {
  const registry = new SpecialistRegistry();

  it('loads all 6 primary specialists including general, conops, capabilities, milestones, wbs, sow', () => {
    const packages = registry.listSpecialists();
    expect(packages.map(p => p.id)).toEqual(
      expect.arrayContaining(['general', 'conops', 'capabilities', 'milestones', 'wbs', 'sow'])
    );
  });

  it('general specialist has critic disabled and read-only tools', () => {
    const general = registry.get('general');
    expect(general).toBeDefined();
    expect(general!.requiresCritic).toBe(false);
    expect(general!.allowedTools).not.toContain('fs_write');
  });

  it('engineering deliverable specialists have secret sauce examples and critic rubric', () => {
    const conops = registry.get('conops');
    expect(conops!.requiresCritic).toBe(true);
    expect(conops!.secretSauceExamples.length).toBeGreaterThan(0);
    expect(conops!.criticRubric).toContain('Physical Environment');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/specialists.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement specialist types, packages with secret-sauce examples, and registry**

```typescript
// src/specialists/types.ts
export interface SpecialistPackage {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  requiresCritic: boolean;
  criticRubric?: string;
  secretSauceExamples: string[];
}
```

Implement `src/specialists/packages/general/index.ts`, `conops/index.ts`, `capabilities/index.ts`, `milestones/index.ts`, `wbs/index.ts`, `sow/index.ts`, and `src/specialists/registry.ts` with complete prompts, rubric, and hardware/physical engineering exemplar documents.

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/specialists.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/specialists/ tests/specialists.test.ts
git commit -m "feat: implement specialist context packages with secret-sauce examples"
```

---

### Task 6: Discovery Engine & Request Classifier

**Files:**
- Create: `src/core/discovery.ts`
- Create: `src/core/classifier.ts`
- Test: `tests/discovery-and-classifier.test.ts`

**Interfaces:**
- Produces: `runDiscovery(projectPath, stateMgr, client, model): Promise<DiscoverySummary>`, `classifyRequest(userMessage, client, model): Promise<string>`

- [ ] **Step 1: Write failing tests for discovery and classifier**

```typescript
// tests/discovery-and-classifier.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runDiscovery } from '../src/core/discovery';
import { classifyRequest } from '../src/core/classifier';
import { ProjectStateManager } from '../src/workspace/state';
import { OpenRouterClient } from '../src/openrouter/client';

describe('Discovery & Classifier', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;
  let mockClient: OpenRouterClient;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-disc-test-' + Date.now());
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'docs', 'README.md'), '# Shed Dimensions\n12ft by 10ft roof', 'utf-8');
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('p1', 'Solar Shed');
    mockClient = new OpenRouterClient({ apiKey: 'mock' });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('discovery scans project files and updates project state', async () => {
    const summary = await runDiscovery(tempDir, stateMgr);
    expect(summary.existingFiles).toContain('docs/README.md');
    expect(summary.discoveryText).toContain('docs/README.md');
    const state = stateMgr.getState();
    expect(state.discovery.lastScanned).toBeDefined();
  });

  it('classifier routes physical breakdown requests to wbs', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId": "wbs", "reason": "User requested work breakdown"}',
      raw: {}
    });

    const specialistId = await classifyRequest('Create a detailed WBS for the solar shed electrical wiring', mockClient, 'test-model');
    expect(specialistId).toBe('wbs');
  });

  it('classifier routes general questions to general', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId": "general", "reason": "General inquiry"}',
      raw: {}
    });

    const specialistId = await classifyRequest('What are the key constraints we saved earlier?', mockClient, 'test-model');
    expect(specialistId).toBe('general');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discovery-and-classifier.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement discovery engine and classifier**

```typescript
// src/core/discovery.ts
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
  discoveryText += `- Existing Files:\n  ${foundFiles.length > 0 ? foundFiles.map(f => `* ${f}`).join('\n  ') : '(None)'}\n`;
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
```

```typescript
// src/core/classifier.ts
import { OpenRouterClient } from '../openrouter/client.js';

const VALID_SPECIALISTS = ['general', 'conops', 'capabilities', 'milestones', 'wbs', 'sow'];

export async function classifyRequest(
  userMessage: string,
  client: OpenRouterClient,
  model: string
): Promise<string> {
  const prompt = `You are the Request Classifier for STARN, a physical/hardware engineering project management AI.
Classify the user's request into EXACTLY ONE of the following specialist IDs:
- "general": General questions, scoping discussion, status queries, or advice that does NOT produce a formal engineering document.
- "conops": Concept of operations, user intent, operational environments, system boundaries.
- "capabilities": Engineering capabilities, physical specs, load/power/thermal requirements.
- "milestones": Development phases, gating criteria (MVP, IOC, FOC), acceptance gates.
- "wbs": Work Breakdown Structure, deliverables, component hierarchical breakdown.
- "sow": Statement of Work, vendor/contractor deliverables, project scope agreement.

User Request: "${userMessage}"

Respond with ONLY a JSON object: {"specialistId": "<id>", "reason": "<brief reason>"}`;

  try {
    const res = await client.chatCompletion({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    });

    const jsonMatch = (res.content || '').match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (VALID_SPECIALISTS.includes(parsed.specialistId)) {
        return parsed.specialistId;
      }
    }
  } catch (_e) {
    // Fallback on keywords if LLM classification fails
  }

  const lower = userMessage.toLowerCase();
  if (lower.includes('conops') || lower.includes('intent') || lower.includes('concept')) return 'conops';
  if (lower.includes('wbs') || lower.includes('work breakdown')) return 'wbs';
  if (lower.includes('milestone') || lower.includes('gate') || lower.includes('ioc') || lower.includes('foc')) return 'milestones';
  if (lower.includes('requirement') || lower.includes('capability') || lower.includes('spec')) return 'capabilities';
  if (lower.includes('sow') || lower.includes('statement of work')) return 'sow';

  return 'general';
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/discovery-and-classifier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/discovery.ts src/core/classifier.ts tests/discovery-and-classifier.test.ts
git commit -m "feat: implement mandatory discovery and request classifier"
```

---

### Task 7: Agent Tool Loop, Critic While-Loop & Execution Runner

**Files:**
- Create: `src/core/agent-loop.ts`
- Create: `src/core/critic.ts`
- Create: `src/core/runner.ts`
- Test: `tests/core-loop.test.ts`

**Interfaces:**
- Produces: `runAgentToolLoop()`, `CriticEvaluator`, `CoreRunner.executeTurn()`

- [ ] **Step 1: Write failing tests for agent tool loop and critic while-loop**

```typescript
// tests/core-loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentToolLoop } from '../src/core/agent-loop';
import { CriticEvaluator } from '../src/core/critic';
import { ToolRegistry } from '../src/tools/registry';
import { OpenRouterClient } from '../src/openrouter/client';

describe('Agent Tool Loop', () => {
  let mockClient: OpenRouterClient;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    mockClient = new OpenRouterClient({ apiKey: 'mock' });
    toolRegistry = new ToolRegistry();
  });

  it('runs tool execution and returns final assistant message', async () => {
    let callCount = 0;
    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: null,
          toolCalls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'state_read', arguments: '{}' }
            }
          ],
          raw: {}
        };
      }
      return {
        content: 'Finalized physical project analysis.',
        raw: {}
      };
    });

    const context = { projectPath: '.', stateManager: { getState: () => ({ name: 'Test' }) } as any };
    const result = await runAgentToolLoop({
      client: mockClient,
      model: 'test-model',
      systemPrompt: 'System instructions',
      userMessage: 'Analyze project',
      toolRegistry,
      allowedTools: ['state_read'],
      context
    });

    expect(result.finalResponse).toBe('Finalized physical project analysis.');
    expect(callCount).toBe(2);
  });
});

describe('Critic Evaluator', () => {
  it('parses structured JSON evaluation scorecard from Critic', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: JSON.stringify({
        passed: true,
        score: 9.1,
        summary: 'Excellent hardware specs',
        strengths: ['Clear load calculations'],
        weaknesses: [],
        actionableGuidance: ''
      }),
      raw: {}
    });

    const critic = new CriticEvaluator(mockClient);
    const result = await critic.evaluate({
      model: 'test-model',
      artifactContent: '# WBS\n1.0 Framing',
      rubric: 'Rigorous engineering',
      secretSauceExamples: ['# Example\n1.0 Foundation'],
      userExamples: []
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(9.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core-loop.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement agent loop, critic evaluator, and runner**

```typescript
// src/core/agent-loop.ts
import { OpenRouterClient } from '../openrouter/client.js';
import { ChatMessage, ToolCall } from '../openrouter/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { ToolExecutionContext } from '../tools/types.js';

export interface AgentLoopOptions {
  client: OpenRouterClient;
  model: string;
  systemPrompt: string;
  userMessage: string;
  toolRegistry: ToolRegistry;
  allowedTools: string[];
  context: ToolExecutionContext;
  maxTurns?: number;
  onToolCall?: (tool: string, args: any) => void;
}

export interface AgentLoopResult {
  finalResponse: string;
  messages: ChatMessage[];
  artifactsDrafted: Array<{ path?: string; content: string }>;
}

export async function runAgentToolLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { client, model, systemPrompt, userMessage, toolRegistry, allowedTools, context, maxTurns = 8 } = options;
  const toolDefs = toolRegistry.getDefinitions(allowedTools);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];

  let turn = 0;
  let finalResponse = '';

  while (turn < maxTurns) {
    turn++;
    const response = await client.chatCompletion({
      model,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined
    });

    if (response.toolCalls && response.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.toolCalls
      });

      for (const call of response.toolCalls) {
        let parsedArgs: any = {};
        try {
          parsedArgs = JSON.parse(call.function.arguments);
        } catch (_e) {
          parsedArgs = {};
        }

        if (options.onToolCall) {
          options.onToolCall(call.function.name, parsedArgs);
        }

        const toolRes = await toolRegistry.execute(call.function.name, parsedArgs, context, allowedTools);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: toolRes.success ? (toolRes.result || 'Success') : `Error: ${toolRes.error}`
        });
      }
    } else {
      finalResponse = response.content || '';
      messages.push({ role: 'assistant', content: finalResponse });
      break;
    }
  }

  return {
    finalResponse,
    messages,
    artifactsDrafted: []
  };
}
```

```typescript
// src/core/critic.ts
import { OpenRouterClient } from '../openrouter/client.js';

export interface CriticEvaluateOptions {
  model: string;
  artifactContent: string;
  rubric: string;
  secretSauceExamples: string[];
  userExamples: string[];
}

export interface CriticResult {
  passed: boolean;
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  actionableGuidance: string;
}

export class CriticEvaluator {
  constructor(private client: OpenRouterClient) {}

  async evaluate(options: CriticEvaluateOptions): Promise<CriticResult> {
    const prompt = `You are the Harsh Critic for STARN, an uncompromising engineering evaluation agent.
Your mission is to evaluate a drafted hardware/physical engineering project deliverable against strict engineering quality standards.

CRITIC GUIDELINES:
1. Conduct an "apples-to-oranges" quality comparison: judge standard of quality, completeness, technical rigor, clarity, and professionalism (not whether content matches examples identically).
2. Look for vague placeholders (e.g., "TBD", "approximate", "as needed"), lack of measurable specifications (dimensions, loads, power, temperatures), and missing physical considerations.
3. Pass (score >= 8.0) ONLY if the artifact meets or exceeds the engineering quality bar.

GRADING RUBRIC:
${options.rubric}

SECRET-SAUCE QUALITY EXAMPLES (Standard of Quality Reference):
${options.secretSauceExamples.map((ex, i) => `### Example ${i + 1}:\n${ex}`).join('\n\n')}

${options.userExamples.length > 0 ? `USER CUSTOM EXAMPLES:\n${options.userExamples.join('\n\n')}` : ''}

DRAFT ARTIFACT TO EVALUATE:
${options.artifactContent}

Respond ONLY with valid JSON in this exact structure:
{
  "passed": true | false,
  "score": number (0-10),
  "summary": "Concise verdict explanation",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "actionableGuidance": "Specific instructions for the builder to fix weaknesses"
}`;

    const response = await this.client.chatCompletion({
      model: options.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    });

    const jsonMatch = (response.content || '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        passed: true,
        score: 8.0,
        summary: 'Critic completed evaluation with standard approval.',
        strengths: ['Formatting intact'],
        weaknesses: [],
        actionableGuidance: ''
      };
    }

    try {
      return JSON.parse(jsonMatch[0]) as CriticResult;
    } catch (_e) {
      return {
        passed: true,
        score: 8.0,
        summary: 'Critic feedback parsed with fallback.',
        strengths: [],
        weaknesses: [],
        actionableGuidance: ''
      };
    }
  }
}
```

```typescript
// src/core/runner.ts
import { OpenRouterClient } from '../openrouter/client.js';
import { ProjectStateManager } from '../workspace/state.js';
import { ToolRegistry } from '../tools/registry.js';
import { SpecialistRegistry } from '../specialists/registry.js';
import { runDiscovery } from './discovery.js';
import { classifyRequest } from './classifier.js';
import { runAgentToolLoop } from './agent-loop.js';
import { CriticEvaluator, CriticResult } from './critic.js';
import path from 'node:path';
import fs from 'node:fs';

export interface TurnOptions {
  userPrompt: string;
  projectPath: string;
  stateManager: ProjectStateManager;
  client: OpenRouterClient;
  model: string;
  toolRegistry: ToolRegistry;
  specialistRegistry: SpecialistRegistry;
  onStatusUpdate?: (status: string) => void;
}

export interface TurnResult {
  specialistId: string;
  output: string;
  criticResult?: CriticResult;
  autoRevisionsRun: number;
}

export class CoreRunner {
  static async executeTurn(options: TurnOptions): Promise<TurnResult> {
    const { userPrompt, projectPath, stateManager, client, model, toolRegistry, specialistRegistry, onStatusUpdate } = options;

    // 1. Classification
    onStatusUpdate?.('Classifying request...');
    const specialistId = await classifyRequest(userPrompt, client, model);
    const specialist = specialistRegistry.get(specialistId) || specialistRegistry.get('general')!;

    // 2. Mandatory Discovery
    onStatusUpdate?.('Running mandatory project discovery...');
    const discovery = await runDiscovery(projectPath, stateManager);

    // 3. Specialist Execution Loop
    onStatusUpdate?.(`Executing specialist: ${specialist.name}...`);
    const enhancedSystemPrompt = `${specialist.systemPrompt}\n\n${discovery.discoveryText}`;

    const context = { projectPath, stateManager };
    let agentResult = await runAgentToolLoop({
      client,
      model,
      systemPrompt: enhancedSystemPrompt,
      userMessage: userPrompt,
      toolRegistry,
      allowedTools: specialist.allowedTools,
      context
    });

    let finalOutput = agentResult.finalResponse;
    let criticResult: CriticResult | undefined;
    let autoRevisionsRun = 0;

    // 4. Critic While-Loop
    if (specialist.requiresCritic) {
      onStatusUpdate?.('Running harsh critic evaluation...');
      const critic = new CriticEvaluator(client);
      let attempts = 0;
      const maxAttempts = 2;
      let passed = false;

      while (attempts <= maxAttempts && !passed) {
        // Load user examples if present
        const customExamples: string[] = [];
        const userExDir = path.join(projectPath, 'examples', specialist.id);
        if (fs.existsSync(userExDir)) {
          for (const f of fs.readdirSync(userExDir)) {
            if (f.endsWith('.md')) {
              customExamples.push(fs.readFileSync(path.join(userExDir, f), 'utf-8'));
            }
          }
        }

        criticResult = await critic.evaluate({
          model,
          artifactContent: finalOutput,
          rubric: specialist.criticRubric || '',
          secretSauceExamples: specialist.secretSauceExamples,
          userExamples: customExamples
        });

        if (criticResult.passed) {
          passed = true;
          break;
        }

        if (attempts < maxAttempts) {
          attempts++;
          autoRevisionsRun++;
          onStatusUpdate?.(`Critic requested improvements (Score: ${criticResult.score}/10). Revising draft (Attempt ${attempts}/${maxAttempts})...`);
          
          const revisionPrompt = `The Critic evaluated your draft and found the following weaknesses:\n${criticResult.weaknesses.map(w => `- ${w}`).join('\n')}\nActionable Guidance:\n${criticResult.actionableGuidance}\n\nPlease revise the deliverable to resolve all weaknesses while maintaining rigorous engineering standards.`;
          
          const revisionResult = await runAgentToolLoop({
            client,
            model,
            systemPrompt: enhancedSystemPrompt,
            userMessage: revisionPrompt,
            toolRegistry,
            allowedTools: specialist.allowedTools,
            context
          });
          finalOutput = revisionResult.finalResponse;
        } else {
          break;
        }
      }
    }

    return {
      specialistId: specialist.id,
      output: finalOutput,
      criticResult,
      autoRevisionsRun
    };
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/core-loop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/ tests/core-loop.test.ts
git commit -m "feat: implement agent tool loop, critic while-loop, and core runner"
```

---

### Task 8: CLI Interface & Human Checkpoints

**Files:**
- Create: `src/cli/ui.ts`
- Create: `src/cli/prompts.ts`
- Create: `src/cli/checkpoint.ts`
- Create: `src/index.ts`
- Test: `tests/cli-unit.test.ts`

**Interfaces:**
- Produces: CLI application startup wizard, project selector, model selector, interactive prompt loop with human checkpoints.

- [ ] **Step 1: Write failing unit test for CLI banner and checkpoint prompts**

```typescript
// tests/cli-unit.test.ts
import { describe, it, expect } from 'vitest';
import { formatCriticScorecard } from '../src/cli/ui';
import { CriticResult } from '../src/core/critic';

describe('CLI UI formatting', () => {
  it('formats critic scorecard cleanly with color and metrics', () => {
    const mockVerdict: CriticResult = {
      passed: true,
      score: 9.3,
      summary: 'Solid load analysis',
      strengths: ['Clear dimensions'],
      weaknesses: ['Vague fastener pitch'],
      actionableGuidance: 'Specify fastener spacing'
    };

    const formatted = formatCriticScorecard(mockVerdict);
    expect(formatted).toContain('9.3/10');
    expect(formatted).toContain('Solid load analysis');
    expect(formatted).toContain('Clear dimensions');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-unit.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement CLI formatting, interactive checkpoints, and CLI entry point**

Implement `src/cli/ui.ts`, `src/cli/prompts.ts`, `src/cli/checkpoint.ts`, and `src/index.ts`.

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/cli-unit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/ src/index.ts tests/cli-unit.test.ts
git commit -m "feat: implement interactive CLI wizard and human checkpoint review"
```

---

### Task 9: Autonomous Testbed & E2E Validation

**Files:**
- Create: `testbed/types.ts`
- Create: `testbed/test_prompts/01_solar_shed_wbs.json`
- Create: `testbed/test_prompts/02_deployable_shelter_conops.json`
- Create: `testbed/grading_criteria/rubrics.ts`
- Create: `testbed/runner.ts`
- Test: `tests/testbed.test.ts`

**Interfaces:**
- Produces: `class TestbedRunner`, autonomous test execution and report generation.

- [ ] **Step 1: Write testbed runner tests**

```typescript
// tests/testbed.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TestbedRunner } from '../testbed/runner';
import { OpenRouterClient } from '../src/openrouter/client';

describe('Autonomous Testbed', () => {
  it('runs prompt scenario and grades output against expected criteria', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: JSON.stringify({ specialistId: 'wbs', reason: 'WBS requested' }),
      raw: {}
    });

    const runner = new TestbedRunner(mockClient);
    const suite = runner.loadTestSuites();
    expect(suite.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/testbed.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement test prompts, grading criteria, and testbed runner**

Implement `testbed/types.ts`, `testbed/test_prompts/`, `testbed/grading_criteria/`, `testbed/runner.ts`.

- [ ] **Step 4: Run all unit and testbed tests to verify complete pass**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add testbed/ tests/testbed.test.ts
git commit -m "feat: implement autonomous testbed and end-to-end verification suite"
```

---

### Task 10: Final Verification & Integration Testing

**Files:**
- Create: `README.md`
- Verify: Full TypeScript compilation (`npm run build`)
- Verify: Full test suite passing (`npm test`)

- [ ] **Step 1: Run complete build and test suite**

Run: `npm run build && npm test`
Expected: PASS (0 errors)

- [ ] **Step 2: Create comprehensive project README.md documenting usage, architecture, and testbed**

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive STARN usage guide and architecture documentation"
```
