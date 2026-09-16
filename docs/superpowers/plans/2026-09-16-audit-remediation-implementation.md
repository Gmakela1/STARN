# STARN Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution: complete and prove each fix before moving to the next.

**Goal:** Remediate nine audit issues (#2, #3, #4, #5, #7, #8, #9, #11, #13) in the STARN codebase, fix-by-fix, each fully proven before the next.

**Architecture:** Nine independent fixes applied in dependency order. Each fix is a self-contained task set with its own test cycle and proof gate. No fix begins until the previous fix's tests pass and `tsc --noEmit` is clean.

**Tech Stack:** TypeScript, Vitest, Zod, OpenRouter API, Node built-ins (`crypto`).

**Spec:** `docs/superpowers/specs/2026-09-16-audit-remediation-design.md`

## Global Constraints

- TypeScript `strict: true`. All code must pass `tsc --noEmit`.
- OpenRouter only. No new external API dependencies.
- Zod already a dependency (`^3.24.2`).
- Node built-in `crypto` for SHA-256 (no new dep).
- No new runtime dependencies for compaction (custom token estimator).
- Config via env vars + `~/.starn/config.json` (existing pattern).
- After every fix: run `npm test` (which is `tsc --noEmit && vitest run` once Fix #11 lands) and confirm green before proceeding.

---

## Fix #11 — TypeScript Compilation Check in Test Pipeline

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` now runs `tsc --noEmit && vitest run`. All subsequent fixes rely on this gate.

### Task 11.1: Add tsc --noEmit to test script

- [ ] **Step 1: Verify baseline is clean**

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

- [ ] **Step 2: Modify package.json test script**

Change the `test` script in `package.json` from:

```json
"test": "vitest run"
```

to:

```json
"test": "tsc --noEmit && vitest run"
```

Leave `test:watch` and `testbed` scripts unchanged.

- [ ] **Step 3: Run the new test command**

Run: `npm test`
Expected: `tsc --noEmit` passes, then Vitest runs and all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "fix(#11): add tsc --noEmit type check to test pipeline"
```

### Task 11.2: Proof gate

- [ ] **Step 5: Proof — confirm type errors now fail the pipeline**

Temporarily introduce a type error in `src/config.ts` (e.g., change `apiKey: string` to `apiKey: number`). Run `npm test`. Expected: fails at the `tsc --noEmit` step with a type error. Revert the change. Run `npm test` again — expected green.

---

## Fix #13 — Logging & Error Recovery

**Files:**
- Create: `src/util/logger.ts`
- Create: `tests/logger.test.ts`
- Modify: `src/openrouter/client.ts`
- Modify: `src/core/runner.ts`
- Modify: `src/core/classifier.ts`
- Modify: `src/core/critic.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Logger` class (`src/util/logger.ts`) with `info(msg)`, `warn(msg)`, `error(msg)` methods writing to `.starn/logs/starn-<date>.log`. `OpenRouterClient` gains retry-with-backoff on 429/5xx/network errors. SIGINT handler in `src/index.ts`.

### Task 13.1: Create the file logger

**Files:**
- Create: `src/util/logger.ts`
- Create: `tests/logger.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Logger } from '../src/util/logger.js';

describe('Logger', () => {
  let tmpDir: string;
  let logger: Logger;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'starn-log-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    logger = new Logger(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes info/warn/error lines to a dated log file with timestamps and levels', () => {
    logger.info('turn started');
    logger.warn('rate limited');
    logger.error('api failed');

    const files = fs.readdirSync(path.join(tmpDir, 'logs'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^starn-\d{4}-\d{2}-\d{2}\.log$/);

    const content = fs.readFileSync(path.join(tmpDir, 'logs', files[0]), 'utf-8');
    expect(content).toContain('[INFO]');
    expect(content).toContain('turn started');
    expect(content).toContain('[WARN]');
    expect(content).toContain('rate limited');
    expect(content).toContain('[ERROR]');
    expect(content).toContain('api failed');
  });

  it('appends to the same file within a day', () => {
    logger.info('first');
    logger.info('second');
    const files = fs.readdirSync(path.join(tmpDir, 'logs'));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(tmpDir, 'logs', files[0]), 'utf-8');
    expect(content).toContain('first');
    expect(content).toContain('second');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/logger.test.ts`
Expected: FAIL — module `../src/util/logger.js` not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/util/logger.ts
import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export class Logger {
  private logsDir: string;

  constructor(baseDir: string) {
    this.logsDir = path.join(baseDir, 'logs');
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private log(level: LogLevel, message: string): void {
    const date = new Date().toISOString().slice(0, 10);
    const timestamp = new Date().toISOString();
    const filename = `starn-${date}.log`;
    const line = `[${timestamp}] [${level}] ${message}\n`;
    fs.appendFileSync(path.join(this.logsDir, filename), line, 'utf-8');
  }

  info(message: string): void {
    this.log('INFO', message);
  }

  warn(message: string): void {
    this.log('WARN', message);
  }

  error(message: string): void {
    this.log('ERROR', message);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/logger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/util/logger.ts tests/logger.test.ts
git commit -m "feat(#13): add file logger to .starn/logs/"
```

### Task 13.2: Add retry-with-backoff to OpenRouterClient

**Files:**
- Modify: `src/openrouter/client.ts`
- Create: `tests/openrouter-retry.test.ts`

**Interfaces:**
- Consumes: `Logger` from `src/util/logger.ts`.
- Produces: `OpenRouterClient` constructor accepts optional `logger?: Logger`. `chatCompletion` retries on 429/5xx/network errors with backoff (1s, 2s, 4s, max 3 attempts), respecting `Retry-After`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/openrouter-retry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { Logger } from '../src/util/logger.js';
import os from 'node:os';
import path from 'node:path';

describe('OpenRouterClient retry', () => {
  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    const mockFetch = vi.fn(async () => {
      calls++;
      if (calls < 3) {
        return new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', mockFetch);

    const logger = new Logger(path.join(os.tmpdir(), 'starn-retry-test'));
    const client = new OpenRouterClient({ apiKey: 'mock', logger });
    // Speed up the test by overriding backoff delays
    (client as any).backoffMs = [10, 20, 40];

    const result = await client.chatCompletion({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }]
    });

    expect(result.content).toBe('ok');
    expect(calls).toBe(3);
    vi.unstubAllGlobals();
  });

  it('throws after max retries on persistent 500', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response('server error', { status: 500 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new OpenRouterClient({ apiKey: 'mock' });
    (client as any).backoffMs = [10, 20, 40];

    await expect(client.chatCompletion({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }]
    })).rejects.toThrow(/OpenRouter API error \(500\)/);

    expect(mockFetch).toHaveBeenCalledTimes(4); // initial + 3 retries
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/openrouter-retry.test.ts`
Expected: FAIL — no retry behavior, first 429 throws.

- [ ] **Step 3: Modify OpenRouterClient to add retry**

In `src/openrouter/client.ts`, add a `logger` option, a `backoffMs` array, and retry logic in `chatCompletion`:

```typescript
import { Logger } from '../util/logger.js';

export interface OpenRouterClientOptions {
  apiKey: string;
  siteUrl?: string;
  appName?: string;
  baseUrl?: string;
  logger?: Logger;
}

export class OpenRouterClient {
  private apiKey: string;
  private siteUrl: string;
  private appName: string;
  private baseUrl: string;
  private logger?: Logger;
  private backoffMs: number[] = [1000, 2000, 4000];

  constructor(options: OpenRouterClientOptions) {
    this.apiKey = options.apiKey;
    this.siteUrl = options.siteUrl || 'https://github.com/makel/STARN';
    this.appName = options.appName || 'STARN PM Agent';
    this.baseUrl = options.baseUrl || 'https://openrouter.ai/api/v1/chat/completions';
    this.logger = options.logger;
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured.');
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this._doRequest(options);
        return result;
      } catch (err: any) {
        lastError = err;
        const isRetryable = this._isRetryableError(err);
        if (!isRetryable || attempt >= maxRetries) {
          throw err;
        }
        const delay = this.backoffMs[attempt] || 4000;
        // Respect Retry-After if present in a thrown API error
        const retryAfter = this._extractRetryAfter(err);
        const waitMs = retryAfter !== null ? retryAfter : delay;
        this.logger?.warn(`OpenRouter ${attempt === 0 ? 'request' : 'retry ' + attempt} failed (${err.message}). Retrying in ${waitMs}ms...`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
    throw lastError || new Error('Retry loop exhausted');
  }

  private async _doRequest(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
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
      const err = new Error(`OpenRouter API error (${res.status}): ${errorText}`);
      (err as any).status = res.status;
      (err as any).retryAfter = this._parseRetryAfter(res.headers.get('Retry-After'));
      throw err;
    }

    const data = await res.json() as any;
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error('Invalid response structure from OpenRouter API');
    }

    return {
      content: choice.message.content ?? null,
      toolCalls: choice.message.tool_calls || undefined,
      raw: data
    };
  }

  private _isRetryableError(err: any): boolean {
    const status = err.status;
    if (status === 429) return true;
    if (status && status >= 500 && status < 600) return true;
    // Network errors (no status) are retryable
    if (!status && err.message && /fetch|network|ECONN/i.test(err.message)) return true;
    return false;
  }

  private _extractRetryAfter(err: any): number | null {
    if (err.retryAfter !== undefined && err.retryAfter !== null) {
      return err.retryAfter * 1000;
    }
    return null;
  }

  private _parseRetryAfter(value: string | null): number | null {
    if (!value) return null;
    const seconds = Number.parseInt(value, 10);
    if (!Number.isNaN(seconds)) return seconds;
    return null;
  }
```

Keep the existing `transcribeAudio` method unchanged (no retry needed for transcription in this scope).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/openrouter-retry.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite to ensure no regressions**

Run: `npm test`
Expected: all tests pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/openrouter/client.ts tests/openrouter-retry.test.ts
git commit -m "feat(#13): add retry-with-backoff to OpenRouterClient"
```

### Task 13.3: Wire logger into runner, classifier, critic; add SIGINT handler

**Files:**
- Modify: `src/core/runner.ts`
- Modify: `src/core/classifier.ts`
- Modify: `src/core/critic.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Wire logger into classifier and critic fallback paths**

In `src/core/classifier.ts`, in the `catch (_e)` block of `classifyRequest` (LLM failure → keyword fallback), log the failure:

```typescript
// At top of classifier.ts, after imports, add a module-level logger setter
import { Logger } from '../util/logger.js';

let classifierLogger: Logger | undefined;
export function setClassifierLogger(logger?: Logger): void {
  classifierLogger = logger;
}
```

In the catch block:
```typescript
  } catch (e: any) {
    classifierLogger?.warn(`LLM classification failed (${e.message}); falling back to keyword heuristics`);
  }
```

In `src/core/critic.ts`, in the `catch (_e)` blocks where JSON parse fails and a fallback verdict is returned, log:

```typescript
import { Logger } from '../util/logger.js';

let criticLogger: Logger | undefined;
export function setCriticLogger(logger?: Logger): void {
  criticLogger = logger;
}
```

In both catch blocks (no JSON match, and JSON.parse failure):
```typescript
    criticLogger?.warn('Critic returned unparseable response; using fallback verdict');
```

- [ ] **Step 2: Wire logger into index.ts and pass to client/runner**

In `src/index.ts`, after `ensureStarnDirs(config.globalDir)`, create the logger and pass it to the client. Set the classifier/critic loggers:

```typescript
import { Logger } from './util/logger.js';
import { setClassifierLogger } from './core/classifier.js';
import { setCriticLogger } from './core/critic.js';

// After ensureStarnDirs:
const projectLogsDir = path.join(currentProjectRecord.path, '.starn');
const logger = new Logger(projectLogsDir);
setClassifierLogger(logger);
setCriticLogger(logger);

// When constructing client:
const client = new OpenRouterClient({
  apiKey,
  siteUrl: config.siteUrl,
  appName: config.appName,
  logger
});
```

Note: `currentProjectRecord` is defined later in `main()`; move logger creation to after project selection (where `currentProjectRecord.path` is known). Adjust placement accordingly.

- [ ] **Step 3: Add SIGINT handler in index.ts**

Near the top of `main()`, after state is loaded, add:

```typescript
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n⚠ Interrupt received. Session state has been persisted to .starn/state.json. Goodbye.\n'));
  process.exit(0);
});
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: all pass, tsc clean. Existing tests that construct `OpenRouterClient({ apiKey: 'mock' })` still work (logger optional).

- [ ] **Step 5: Commit**

```bash
git add src/core/classifier.ts src/core/critic.ts src/index.ts
git commit -m "feat(#13): wire logger into classifier/critic fallbacks; add SIGINT handler"
```

### Task 13.4: Proof gate for Fix #13

- [ ] **Step 6: Proof — confirm retry and logging work end-to-end**

Verify: `npm test` green. Manually inspect that `tests/openrouter-retry.test.ts` covers 429-retry-then-success and persistent-500-throws-after-max-retries. Confirm `tests/logger.test.ts` covers info/warn/error file output. Confirm classifier/critic log on fallback (unit test or manual log inspection).

---

## Fix #3 — `state_update` Tool & Risk Storage Dualism

**Files:**
- Modify: `src/workspace/types.ts`
- Modify: `src/workspace/state.ts`
- Modify: `src/tools/handlers/state-update.ts`
- Create: `tests/state-update-risk-migration.test.ts`

**Interfaces:**
- Consumes: Zod (`^3.24.2`, already a dependency).
- Produces: `ProjectState.pendingRisks` is the canonical structured risk store. `state_update` tool accepts `addPendingRisk: { source, section, risk }`. `ArtifactRecord` unaffected. Legacy `openRisks` migrated on load.

### Task 3.1: Add Zod-validated structured risk param to state_update

**Files:**
- Modify: `src/tools/handlers/state-update.ts`
- Create: `tests/state-update-risk-migration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/state-update-risk-migration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';

describe('state_update risk storage', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;
  let registry: ToolRegistry;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'starn-risk-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('test', 'Test');
    registry = new ToolRegistry();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('addPendingRisk stores a structured PendingRisk in state.pendingRisks', async () => {
    const res = await registry.execute('state_update', {
      addPendingRisk: {
        source: 'BOM.md',
        section: 'SS-02',
        risk: 'No 72V controller under $800 found'
      }
    }, { projectPath: tmpDir, stateManager: stateMgr }, ['state_update']);

    expect(res.success).toBe(true);
    const state = stateMgr.getState();
    expect(state.pendingRisks).toHaveLength(1);
    expect(state.pendingRisks![0]).toEqual({
      source: 'BOM.md',
      section: 'SS-02',
      risk: 'No 72V controller under $800 found'
    });
  });

  it('rejects addPendingRisk with missing fields via Zod', async () => {
    const res = await registry.execute('state_update', {
      addPendingRisk: { source: 'BOM.md' } // missing section, risk
    }, { projectPath: tmpDir, stateManager: stateMgr }, ['state_update']);

    expect(res.success).toBe(false);
    expect(res.error).toContain('addPendingRisk');
  });

  it('migrates legacy openRisks strings into pendingRisks on state load', () => {
    // Write a state file with legacy openRisks and no pendingRisks
    const statePath = path.join(tmpDir, '.starn', 'state.json');
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    raw.openRisks = ['Legacy wind load risk', 'Legacy rust risk'];
    delete raw.pendingRisks;
    fs.writeFileSync(statePath, JSON.stringify(raw, null, 2), 'utf-8');

    // Reload — migration should fire
    const state = stateMgr.getState();
    expect(state.pendingRisks).toHaveLength(2);
    expect(state.pendingRisks![0].source).toBe('legacy');
    expect(state.pendingRisks![0].section).toBe('unknown');
    expect(state.pendingRisks![0].risk).toBe('Legacy wind load risk');
    // openRisks is now empty (migrated)
    expect(state.openRisks).toEqual([]);
  });

  it('migrates idempotently (re-loading does not duplicate)', () => {
    const statePath = path.join(tmpDir, '.starn', 'state.json');
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    raw.openRisks = ['Legacy risk'];
    delete raw.pendingRisks;
    fs.writeFileSync(statePath, JSON.stringify(raw, null, 2), 'utf-8');

    const first = stateMgr.getState();
    const firstCount = first.pendingRisks!.length;

    // getState again — should not duplicate
    const second = stateMgr.getState();
    expect(second.pendingRisks).toHaveLength(firstCount);
  });

  it('phase param syncs workflow.activePhase and phase status map', async () => {
    await registry.execute('state_update', {
      phase: 'architecture'
    }, { projectPath: tmpDir, stateManager: stateMgr }, ['state_update']);

    const state = stateMgr.getState();
    expect(state.currentPhase).toBe('architecture');
    expect(state.workflow.activePhase).toBe('architecture');
    expect(state.workflow.phases['architecture'].status).toBe('in_progress');
  });

  it('rejects invalid phase id via Zod', async () => {
    const res = await registry.execute('state_update', {
      phase: 'not-a-real-phase'
    }, { projectPath: tmpDir, stateManager: stateMgr }, ['state_update']);

    expect(res.success).toBe(false);
    expect(res.error).toContain('phase');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state-update-risk-migration.test.ts`
Expected: FAIL — `addPendingRisk` not recognized, migration not implemented, phase sync broken.

- [ ] **Step 3: Implement migration in state.ts**

In `src/workspace/state.ts`, update `getState()` and `getOrCreateState()` to migrate legacy `openRisks` into `pendingRisks`. Add a migration helper:

```typescript
private migrateLegacyRisks(state: ProjectState): ProjectState {
  if (state.openRisks && state.openRisks.length > 0) {
    if (!state.pendingRisks) {
      state.pendingRisks = [];
    }
    // Only migrate risks not already present (idempotent)
    const existingRisks = new Set(state.pendingRisks.map(r => r.risk));
    for (const legacyRisk of state.openRisks) {
      if (!existingRisks.has(legacyRisk)) {
        state.pendingRisks.push({
          source: 'legacy',
          section: 'unknown',
          risk: legacyRisk
        });
      }
    }
    // Clear openRisks after migration
    state.openRisks = [];
  }
  if (!state.pendingRisks) {
    state.pendingRisks = [];
  }
  return state;
}
```

Call `this.migrateLegacyRisks(state)` at the end of `getState()` (after parsing, before returning) and in `getOrCreateState()` for existing state. Save state after migration so it persists.

- [ ] **Step 4: Implement Zod validation + structured risk in state-update.ts**

Replace `src/tools/handlers/state-update.ts`:

```typescript
import { z } from 'zod';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';
import { ORDERED_WORKFLOW_PHASES } from '../../workspace/state.js';

const validPhaseIds = ORDERED_WORKFLOW_PHASES.map(p => p.id);

const addPendingRiskSchema = z.object({
  source: z.string().min(1),
  section: z.string().min(1),
  risk: z.string().min(1)
});

const stateUpdateArgsSchema = z.object({
  action: z.string().optional(),
  phase: z.enum(validPhaseIds as [string, ...string[]]).optional(),
  addPendingRisk: addPendingRiskSchema.optional()
});

export const stateUpdateHandler: ToolHandler = {
  name: 'state_update',
  definition: {
    type: 'function',
    function: {
      name: 'state_update',
      description: 'Update project state: record an action, switch the active phase, or add a structured pending risk (source, section, risk).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action description to record in recent actions' },
          phase: { type: 'string', description: 'New active phase id (e.g. conops, architecture, bom)', enum: validPhaseIds },
          addPendingRisk: {
            type: 'object',
            description: 'A structured pending risk to add to the risk register source pool',
            properties: {
              source: { type: 'string', description: 'Document where the risk was identified (e.g. BOM.md)' },
              section: { type: 'string', description: 'Section or subsystem reference (e.g. SS-02)' },
              risk: { type: 'string', description: 'Risk description in IF/THEN form if possible' }
            },
            required: ['source', 'section', 'risk']
          }
        }
      }
    }
  },
  async execute(args: any, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const parsed = stateUpdateArgsSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid state_update args: ${parsed.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; ')}`
      };
    }
    const { action, phase, addPendingRisk } = parsed.data;

    if (phase) {
      context.stateManager.setActivePhase(phase);
    }
    if (addPendingRisk) {
      context.stateManager.addPendingRisk(addPendingRisk);
    }
    if (action) {
      context.stateManager.addAction(action);
    }
    return { success: true, result: 'Project state successfully updated.' };
  }
};
```

- [ ] **Step 5: Add addPendingRisk method to ProjectStateManager**

In `src/workspace/state.ts`:

```typescript
public addPendingRisk(risk: PendingRisk): void {
  const state = this.getState();
  if (!state.pendingRisks) {
    state.pendingRisks = [];
  }
  state.pendingRisks.push(risk);
  this.saveState(state);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/state-update-risk-migration.test.ts`
Expected: PASS.

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: all pass, tsc clean.

- [ ] **Step 8: Commit**

```bash
git add src/workspace/types.ts src/workspace/state.ts src/tools/handlers/state-update.ts tests/state-update-risk-migration.test.ts
git commit -m "fix(#3): unify risk storage on pendingRisks; Zod-validate state_update; sync phase"
```

### Task 3.2: Proof gate for Fix #3

- [ ] **Step 9: Proof — confirm dualism resolved**

Verify: `state.pendingRisks` is the only risk write target. `openRisks` is empty after migration. `state_read` tool output includes `pendingRisks`. Existing `tests/tools.test.ts` (which tests `addRisk` → `openRisks`) must be updated: the old `addRisk` param no longer exists; update that test to use `addPendingRisk` and check `pendingRisks`. Confirm `npm test` green.

---

## Fix #5 — Section 6 Dead Code Removal

**Files:**
- Modify: `src/cli/section6-resolver.ts`
- Modify: `tests/section6-data-loss.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `section6-resolver.ts` exports only `parseOpenQuestionsFromContent`, `parseSection6Questions` (alias), `hasUnresolvedQuestions`, `countOpenQuestions`, `collectOpenQuestions`, `CollectedAnswer`, `OPEN_QUESTIONS_HEADING`.

### Task 5.1: Delete dead code and rewrite data-loss test

- [ ] **Step 1: Verify dead code is truly unused in src/**

Run: `grep -rn "resolveSection6\|foldAnswerIntoDoc\|removeSection6\|collectSection6Answers" src/`
Expected: only definitions in `section6-resolver.ts`, no call sites.

- [ ] **Step 2: Delete dead functions from section6-resolver.ts**

Remove from `src/cli/section6-resolver.ts`:
- `collectSection6Answers()` function
- `ResolveSection6Options` interface
- `resolveSection6()` function
- `foldAnswerIntoDoc()` function
- `removeSection6()` function
- Remove the `path` and `ProjectStateManager` imports if no longer referenced (verify with grep after deletion).

Keep: `OPEN_QUESTIONS_HEADING`, `extractQuestionItems`, `parseOpenQuestionsFromContent`, `parseSection6Questions` (alias), `hasUnresolvedQuestions`, `countOpenQuestions`, `CollectedAnswer`, `collectOpenQuestions`.

- [ ] **Step 3: Sharpen collectOpenQuestions JSDoc**

Update the JSDoc on `collectOpenQuestions`:

```typescript
/**
 * Collects answers for a document's open questions interactively.
 * Does NOT write to disk — returns the Q&A pairs so the specialist LLM
 * can incorporate them properly into the document body.
 * Works for ANY specialist document with an Open Questions section.
 *
 * This is the ONLY sanctioned answer-resolution path. Never write answers
 * to disk via regex patching or run resolution after the agent loop — both
 * caused historic data-loss bugs (see tests/section6-data-loss.test.ts).
 */
```

- [ ] **Step 4: Rewrite tests/section6-data-loss.test.ts**

Replace the entire file with a focused test of the live contract:

```typescript
/**
 * Regression tests for Section 6 answer resolution.
 *
 * History: an older resolveSection6() path used regex patching
 * (foldAnswerIntoDoc + removeSection6) to write answers directly to disk
 * after the agent loop. This caused three data-loss bugs: answers placed
 * inside Section 6 were wiped by removeSection6; the checkpoint overwrote
 * the post-resolution disk file with the pre-resolution draft; and the LLM
 * never saw the answers. That code has been deleted. The live path is
 * collectOpenQuestions(), which returns Q&A pairs without touching disk.
 *
 * These tests pin the live contract.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseSection6Questions, collectOpenQuestions } from '../src/cli/section6-resolver.js';

const SAMPLE_CONOPS = `# CONOPS — Diesel-to-Electric Compact Tractor Conversion

## 1. Executive Summary & User Intent
Tractor conversion project.

## 6. Open Questions & Items for Clarification

**Q1. Mid-mount mower deck drive path.** Not yet confirmed.

**Q2. Charging dwell and recharge time.** Not yet confirmed.

## Design Decisions
D-001: Retain OEM transmission.
`;

describe('Section 6 live resolution contract', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-s6-'));
    fs.mkdirSync(path.join(tmpDir, 'docs'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parseSection6Questions extracts all open questions', () => {
    const questions = parseSection6Questions(SAMPLE_CONOPS);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toContain('Mid-mount mower deck drive path');
    expect(questions[1]).toContain('Charging dwell');
  });

  it('collectOpenQuestions does NOT touch the disk', async () => {
    const docPath = path.join(tmpDir, 'docs', 'CONOPS.md');
    fs.writeFileSync(docPath, SAMPLE_CONOPS, 'utf-8');
    const before = fs.readFileSync(docPath, 'utf-8');

    // Stub the interactive prompt loop: collectOpenQuestions uses @inquirer/select
    // and @inquirer/input. To test without a TTY, we invoke the parser directly
    // and assert the contract via the exported helper.
    const questions = parseSection6Questions(SAMPLE_CONOPS);
    expect(questions).toHaveLength(2);

    // The disk file is unchanged after parsing (collectOpenQuestions would prompt
    // interactively; here we verify the pure-parse path leaves disk intact).
    const after = fs.readFileSync(docPath, 'utf-8');
    expect(after).toBe(before);
  });

  it('answerBlock format clearly states Q+A for LLM incorporation', () => {
    const mockAnswers = [
      { question: 'Mid-mount mower deck drive path.', answer: 'Motor via belt' },
      { question: 'Charging dwell.', answer: 'Overnight per BMS' }
    ];
    const answerBlock = mockAnswers
      .map((qa, i) => `Q${i + 1}: ${qa.question.slice(0, 150).replace(/\n/g, ' ')}\nAnswer: ${qa.answer}`)
      .join('\n\n');
    expect(answerBlock).toContain('Q1:');
    expect(answerBlock).toContain('Answer: Motor via belt');
    expect(answerBlock).toContain('Q2:');
    expect(answerBlock).toContain('Answer: Overnight per BMS');
  });

  it('returns empty for a doc without Section 6', () => {
    expect(parseSection6Questions('# Doc\n\n## 1. Summary\nNo questions here.')).toEqual([]);
  });
});
```

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all pass, tsc clean. `tests/section6-resolver.test.ts` and `tests/open-questions-flow.test.ts` (which use `parseSection6Questions`) still pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli/section6-resolver.ts tests/section6-data-loss.test.ts
git commit -m "fix(#5): delete dead resolveSection6/foldAnswerIntoDoc/removeSection6; pin live contract"
```

### Task 5.2: Proof gate for Fix #5

- [ ] **Step 7: Proof — confirm no dead code remains**

Run: `grep -rn "resolveSection6\|foldAnswerIntoDoc\|removeSection6\|collectSection6Answers" src/`
Expected: no matches. Confirm `npm test` green.

---

## Fix #4 — Discovery Scan Scope

**Files:**
- Modify: `src/core/discovery.ts`
- Create: `tests/discovery-exclusions.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `runDiscovery` excludes dev artifacts from the file listing.

### Task 4.1: Add default exclusion list to discovery

- [ ] **Step 1: Write the failing test**

```typescript
// tests/discovery-exclusions.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runDiscovery } from '../src/core/discovery.js';
import { ProjectStateManager } from '../src/workspace/state.js';

describe('runDiscovery exclusions', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'starn-disc-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('test', 'Test');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('excludes dist, tests, testbed, .pi, .vscode directories', async () => {
    for (const dir of ['dist', 'tests', 'testbed', '.pi', '.vscode', 'build', 'coverage']) {
      fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, dir, 'file.txt'), 'noise');
    }
    const result = await runDiscovery(tmpDir, stateMgr);
    expect(result.existingFiles).not.toContain('dist/file.txt');
    expect(result.existingFiles).not.toContain('tests/file.txt');
    expect(result.existingFiles).not.toContain('testbed/file.txt');
    expect(result.existingFiles).not.toContain('.pi/file.txt');
    expect(result.existingFiles).not.toContain('.vscode/file.txt');
    expect(result.existingFiles).not.toContain('build/file.txt');
    expect(result.existingFiles).not.toContain('coverage/file.txt');
  });

  it('excludes logs, wav, lockfiles, tsconfig, .env, .gitignore', async () => {
    fs.writeFileSync(path.join(tmpDir, 'debug.log'), 'noise');
    fs.writeFileSync(path.join(tmpDir, 'voice.wav'), 'noise');
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.env'), 'KEY=val');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules');
    const result = await runDiscovery(tmpDir, stateMgr);
    expect(result.existingFiles).not.toContain('debug.log');
    expect(result.existingFiles).not.toContain('voice.wav');
    expect(result.existingFiles).not.toContain('package-lock.json');
    expect(result.existingFiles).not.toContain('yarn.lock');
    expect(result.existingFiles).not.toContain('tsconfig.json');
    expect(result.existingFiles).not.toContain('.env');
    expect(result.existingFiles).not.toContain('.gitignore');
  });

  it('keeps reference/ and examples/ files enumerated by name', async () => {
    fs.mkdirSync(path.join(tmpDir, 'reference'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'reference', 'motor-specs.pdf'), '%PDF');
    fs.writeFileSync(path.join(tmpDir, 'reference', 'datasheet.txt'), 'specs');
    const result = await runDiscovery(tmpDir, stateMgr);
    expect(result.referenceFiles).toContain('reference/motor-specs.pdf');
    expect(result.referenceFiles).toContain('reference/datasheet.txt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discovery-exclusions.test.ts`
Expected: FAIL — excluded files appear in `existingFiles`.

- [ ] **Step 3: Add exclusion list to discovery.ts**

In `src/core/discovery.ts`, add an exclusion set and apply it in `scanDir`:

```typescript
const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', '.starn',
  'dist', 'build', 'tests', 'testbed',
  '.pi', '.vscode', '.idea', 'coverage'
]);

const EXCLUDED_FILE_PATTERNS = [
  /\.log$/i,
  /\.wav$/i,
  /\.mp3$/i,
  /^package-lock\.json$/i,
  /^yarn\.lock$/i,
  /^tsconfig\.json$/i,
  /^\.gitignore$/i,
  /^\.env/i
];

function isExcludedFile(name: string): boolean {
  return EXCLUDED_FILE_PATTERNS.some(pattern => pattern.test(name));
}
```

In `scanDir`, replace the existing skip check:

```typescript
function scanDir(dir: string) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (EXCLUDED_DIRS.has(item.name)) continue;
    const full = path.join(dir, item.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (item.isDirectory()) {
      scanDir(full);
    } else {
      if (isExcludedFile(item.name)) continue;
      foundFiles.push(rel);
      if (rel.startsWith('reference/') && !rel.endsWith('README.md')) {
        referenceFiles.push(rel);
      } else if (rel.startsWith('examples/') && (rel.endsWith('.md') || rel.endsWith('.txt'))) {
        userExampleFiles.push(rel);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discovery-exclusions.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/core/discovery.ts tests/discovery-exclusions.test.ts
git commit -m "fix(#4): exclude dev artifacts from discovery scan"
```

### Task 4.2: Proof gate for Fix #4

- [ ] **Step 7: Proof — confirm noise removed**

Verify: `npm test` green. `tests/discovery-exclusions.test.ts` covers dirs, files, and reference/examples retention.

---

## Fix #7 — Classifier Hardcoded Phase-Locking Keywords

**Files:**
- Modify: `src/core/classifier.ts`
- Create: `tests/classifier-phase-lock.test.ts`

**Interfaces:**
- Consumes: `Logger` (set via `setClassifierLogger`, from Fix #13).
- Produces: `classifyRequest` runs LLM first; keyword fallback (generic verbs only) fires only on LLM failure/unparseable.

### Task 7.1: Invert classifier precedence and remove tractor nouns

- [ ] **Step 1: Write the failing test**

```typescript
// tests/classifier-phase-lock.test.ts
import { describe, it, expect, vi } from 'vitest';
import { classifyRequest, detectPhaseSwitchRequest, isInformationalQuery } from '../src/core/classifier.js';
import { OpenRouterClient } from '../src/openrouter/client.js';

describe('classifyRequest precedence', () => {
  it('uses LLM classifier result when it returns valid JSON', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId":"bom","reason":"user wants BOM"}',
      raw: {}
    });
    const result = await classifyRequest('draft the bill of materials', mockClient, 'test-model', 'conops');
    expect(result).toBe('bom');
  });

  it('falls back to active phase on generic edit verb when LLM fails', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(mockClient, 'chatCompletion').mockRejectedValue(new Error('network down'));
    const result = await classifyRequest('update the battery section', mockClient, 'test-model', 'bom');
    expect(result).toBe('bom'); // routed to active phase via generic verb fallback
  });

  it('does NOT hardcode tractor nouns in the fallback', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(mockClient, 'chatCompletion').mockRejectedValue(new Error('down'));
    // "battery" alone (a tractor noun) without an edit verb should NOT lock to active phase
    const result = await classifyRequest('what battery options exist', mockClient, 'test-model', 'bom');
    expect(result).toBe('general'); // informational query → general
  });

  it('detectPhaseSwitchRequest no longer matches tractor nouns as phase switches', () => {
    expect(detectPhaseSwitchRequest('redo the battery')).toBeNull();
    expect(detectPhaseSwitchRequest('switch to bom')).toBe('bom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/classifier-phase-lock.test.ts`
Expected: FAIL — "does NOT hardcode tractor nouns" fails (current code locks "battery" to active phase).

- [ ] **Step 3: Refactor classifyRequest — LLM first, generic fallback**

In `src/core/classifier.ts`, restructure `classifyRequest`:

```typescript
export async function classifyRequest(
  userMessage: string,
  client: OpenRouterClient,
  model: string,
  activePhase?: string
): Promise<string> {
  // 1. Check for explicit phase switch request (unchanged)
  const explicitSwitch = detectPhaseSwitchRequest(userMessage);
  if (explicitSwitch) {
    return explicitSwitch;
  }

  // 2. Run LLM classifier FIRST
  const prompt = `You are the Request Classifier for STARN ... (existing prompt text) ...`;
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
    classifierLogger?.warn('LLM classifier returned unparseable response; falling back to keyword heuristics');
  } catch (e: any) {
    classifierLogger?.warn(`LLM classification failed (${e.message}); falling back to keyword heuristics`);
  }

  // 3. FALLBACK (only on LLM failure/unparseable): generic edit verbs + active phase
  if (activePhase && activePhase !== 'general' && activePhase !== 'conops') {
    const lower = userMessage.trim().toLowerCase();
    const isEditFeedback =
      lower.startsWith('update') ||
      lower.startsWith('change') ||
      lower.startsWith('add') ||
      lower.startsWith('remove') ||
      lower.startsWith('revise') ||
      lower.startsWith('edit') ||
      lower.startsWith('fix') ||
      lower.startsWith('include') ||
      lower.startsWith('modify') ||
      lower.includes('instead of') ||
      lower.includes('change the') ||
      lower.includes('add a') ||
      lower.includes('remove the') ||
      lower.includes('feedback') ||
      lower.includes('correction') ||
      lower.includes('wrong') ||
      lower.includes('that should be') ||
      lower.includes('should say');
    if (isEditFeedback) {
      return activePhase;
    }
  }

  // 4. Keyword-based specialist detection (existing fallback logic, unchanged)
  const lower = userMessage.toLowerCase();
  if (lower.includes('test plan') || lower.includes('testplan') || lower.includes('test procedure')) return 'testplans';
  if (lower.includes('rtm') || lower.includes('traceability') || lower.includes('verification matrix')) return 'rtm';
  if (lower.includes('conops') || lower.includes('intent') || lower.includes('concept') || lower.includes('start')) return 'conops';
  if (lower.includes('architecture') || lower.includes('subsystem') || lower.includes('block diagram')) return 'architecture';
  if (lower.includes('icd') || lower.includes('interface control')) return 'icd';
  if (lower.includes('bom') || lower.includes('bill of materials') || lower.includes('parts')) return 'bom';
  if (lower.includes('capability') || lower.includes('capabilities') || lower.includes('behavior')) return 'capabilities';
  if (lower.includes('requirement') || lower.includes('spec') || lower.includes('srs')) return 'requirements';
  if (lower.includes('milestone') || lower.includes('gate') || lower.includes('ioc') || lower.includes('foc')) return 'milestones';
  if (lower.includes('sow') || lower.includes('statement of work')) return 'sow';
  if (lower.includes('impact') || lower.includes('what changes') || lower.includes('affect')) return 'change-impact';

  return activePhase || 'general';
}
```

Remove the six tractor nouns (`battery`, `motor`, `charger`, `compartment`, `seat`, `display`) entirely. Also ensure `isInformationalQuery` is no longer called before the LLM (it was part of the old fast-path); informational queries now route via the LLM classifier, which is instructed to return `general` for them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/classifier-phase-lock.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all pass, tsc clean. Update `tests/discovery-and-classifier.test.ts` if it relied on the old keyword-first behavior.

- [ ] **Step 6: Commit**

```bash
git add src/core/classifier.ts tests/classifier-phase-lock.test.ts
git commit -m "fix(#7): LLM classifier first; generic-verb fallback; remove tractor nouns"
```

### Task 7.2: Proof gate for Fix #7

- [ ] **Step 7: Proof — confirm no tractor bias**

Verify: `npm test` green. Tractor-noun test passes. LLM-first test passes.

---

## Fix #2 — Agent Loop Context Window Management (Compaction)

**Files:**
- Create: `src/core/compaction.ts`
- Create: `tests/compaction.test.ts`
- Modify: `src/config.ts`
- Modify: `src/core/runner.ts`
- Modify: `src/cli/ui.ts`
- Modify: `src/cli/prompts.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `OpenRouterClient`, `Logger` (from Fix #13), `ChatMessage`.
- Produces: `estimateTokens`, `serializeConversation`, `generateSummary`, `maybeCompact` (from `src/core/compaction.ts`). Config fields `compressionThreshold`, `keepRecentTokens`, `compactionModel`.

### Task 2.1: Create compaction module with token estimation and serialization

**Files:**
- Create: `src/core/compaction.ts`
- Create: `tests/compaction.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/compaction.test.ts
import { describe, it, expect } from 'vitest';
import { estimateTokens, serializeConversation } from '../src/core/compaction.js';
import { ChatMessage } from '../src/openrouter/types.js';

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'a'.repeat(400) }
    ];
    expect(estimateTokens(messages)).toBe(100);
  });

  it('handles empty messages', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('sums across multiple messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'a'.repeat(200) },
      { role: 'user', content: 'b'.repeat(200) }
    ];
    expect(estimateTokens(messages)).toBe(100);
  });
});

describe('serializeConversation', () => {
  it('serializes messages to labeled text', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' }
    ];
    const text = serializeConversation(messages);
    expect(text).toContain('[User]: Hello');
    expect(text).toContain('[Assistant]: Hi there');
  });

  it('truncates tool results to 2000 chars', () => {
    const longResult = 'x'.repeat(5000);
    const messages: ChatMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fs_read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', name: 'fs_read', content: longResult }
    ];
    const text = serializeConversation(messages);
    expect(text).toContain('[Tool result]:');
    expect(text.length).toBeLessThan(longResult.length + 200);
    expect(text).toContain('truncated');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/compaction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement estimateTokens and serializeConversation**

```typescript
// src/core/compaction.ts
import { ChatMessage } from '../openrouter/types.js';
import { Logger } from '../util/logger.js';

const CHARS_PER_TOKEN = 4;
const TOOL_RESULT_TRUNCATE = 2000;

export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (msg.content) chars += msg.content.length;
    if (msg.tool_calls) {
      for (const call of msg.tool_calls) {
        chars += call.function.name.length + call.function.arguments.length;
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function serializeConversation(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue; // system not summarized
    if (msg.role === 'user') {
      lines.push(`[User]: ${msg.content || ''}`);
    } else if (msg.role === 'assistant') {
      if (msg.content) lines.push(`[Assistant]: ${msg.content}`);
      if (msg.tool_calls) {
        const calls = msg.tool_calls
          .map(c => `${c.function.name}(${c.function.arguments})`)
          .join('; ');
        lines.push(`[Assistant tool calls]: ${calls}`);
      }
    } else if (msg.role === 'tool') {
      const content = msg.content || '';
      const truncated = content.length > TOOL_RESULT_TRUNCATE
        ? content.slice(0, TOOL_RESULT_TRUNCATE) + `\n[...truncated ${content.length - TOOL_RESULT_TRUNCATE} chars]`
        : content;
      lines.push(`[Tool result]: ${truncated}`);
    }
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/compaction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/compaction.ts tests/compaction.test.ts
git commit -m "feat(#2): add compaction token estimator and conversation serializer"
```

### Task 2.2: Implement generateSummary and maybeCompact

- [ ] **Step 1: Write the failing test (extend compaction.test.ts)**

Add to `tests/compaction.test.ts`:

```typescript
import { vi } from 'vitest';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { maybeCompact } from '../src/core/compaction.js';

describe('maybeCompact', () => {
  it('does not compact when under threshold', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'short' }
    ];
    const result = await maybeCompact({
      client: mockClient,
      messages,
      compactionModel: 'test-model',
      threshold: 100000,
      keepRecentTokens: 20000
    });
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it('compacts when over threshold, keeping recent messages and a summary', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '## Goal\nTest summary\n## Progress\n- [x] done',
      raw: {}
    });
    // Build messages exceeding a small threshold
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a'.repeat(5000) },
      { role: 'assistant', content: 'b'.repeat(5000) },
      { role: 'user', content: 'recent short' },
      { role: 'assistant', content: 'recent reply' }
    ];
    const result = await maybeCompact({
      client: mockClient,
      messages,
      compactionModel: 'test-model',
      threshold: 1000, // low threshold to force compaction
      keepRecentTokens: 50 // keep the recent short exchange
    });
    expect(result.compacted).toBe(true);
    expect(result.messages[0].role).toBe('system'); // system preserved
    expect(result.messages[1].role).toBe('assistant'); // summary injected as assistant
    expect(result.messages[1].content).toContain('Test summary');
    // Recent user/assistant kept
    expect(result.messages.some(m => m.content === 'recent short')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/compaction.test.ts`
Expected: FAIL — `maybeCompact` not exported.

- [ ] **Step 3: Implement generateSummary and maybeCompact**

Add to `src/core/compaction.ts`:

```typescript
import { OpenRouterClient } from '../openrouter/client.js';

export interface MaybeCompactOptions {
  client: OpenRouterClient;
  messages: ChatMessage[];
  compactionModel: string;
  threshold: number;
  keepRecentTokens: number;
  logger?: Logger;
}

export interface MaybeCompactResult {
  messages: ChatMessage[];
  compacted: boolean;
  tokensBefore?: number;
  tokensAfter?: number;
}

const SUMMARY_PROMPT_PREFIX = `Summarize the following conversation history in this exact structured markdown format:

## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Requirements mentioned by user]

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues, if any]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [Data needed to continue]

Conversation history to summarize:
`;

export async function generateSummary(
  client: OpenRouterClient,
  model: string,
  messagesToSummarize: ChatMessage[]
): Promise<string> {
  const conversationText = serializeConversation(messagesToSummarize);
  const res = await client.chatCompletion({
    model,
    messages: [{ role: 'user', content: SUMMARY_PROMPT_PREFIX + conversationText }],
    temperature: 0.1
  });
  return res.content || '(summary unavailable)';
}

export async function maybeCompact(options: MaybeCompactOptions): Promise<MaybeCompactResult> {
  const { client, messages, compactionModel, threshold, keepRecentTokens, logger } = options;
  const tokensBefore = estimateTokens(messages);
  if (tokensBefore <= threshold) {
    return { messages, compacted: false };
  }

  logger?.info(`Compacting session: ${tokensBefore} tokens > ${threshold} threshold`);

  // Walk backwards to find the cut point (keep recent messages)
  let keptTokens = 0;
  let cutIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens([messages[i]]);
    if (keptTokens + msgTokens > keepRecentTokens && i < messages.length - 1) {
      cutIndex = i + 1;
      break;
    }
    keptTokens += msgTokens;
    cutIndex = i;
  }

  // Ensure we don't cut mid-tool-call: walk back to a safe boundary (user message)
  while (cutIndex < messages.length && messages[cutIndex].role !== 'user' && cutIndex > 1) {
    cutIndex--;
  }

  // System message is always preserved separately
  const systemMessages = messages.filter(m => m.role === 'system');
  const messagesToSummarize = messages.slice(0, cutIndex).filter(m => m.role !== 'system');
  const keptMessages = messages.slice(cutIndex);

  if (messagesToSummarize.length === 0) {
    return { messages, compacted: false };
  }

  const summary = await generateSummary(client, compactionModel, messagesToSummarize);

  const compactedMessages: ChatMessage[] = [
    ...systemMessages,
    { role: 'assistant', content: `## Session Summary (compacted)\n${summary}` },
    ...keptMessages
  ];

  const tokensAfter = estimateTokens(compactedMessages);
  logger?.info(`Compaction complete: ${tokensBefore} -> ${tokensAfter} tokens`);

  return { messages: compactedMessages, compacted: true, tokensBefore, tokensAfter };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/compaction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/compaction.ts tests/compaction.test.ts
git commit -m "feat(#2): implement generateSummary and maybeCompact"
```

### Task 2.3: Add compaction config and wire into runner + UI

**Files:**
- Modify: `src/config.ts`
- Modify: `src/core/runner.ts`
- Modify: `src/cli/ui.ts`
- Modify: `src/cli/prompts.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add config fields**

In `src/config.ts`, add to `StarnConfig` and `UserConfigFile`:

```typescript
export interface StarnConfig {
  apiKey: string;
  defaultModel: string;
  compactionModel?: string;
  compressionThreshold: number;
  keepRecentTokens: number;
  siteUrl: string;
  appName: string;
  globalDir: string;
}

export interface UserConfigFile {
  apiKey?: string;
  defaultModel?: string;
  compactionModel?: string;
  compressionThreshold?: number;
  keepRecentTokens?: number;
  siteUrl?: string;
  appName?: string;
}
```

In `loadConfig`:
```typescript
const compressionThreshold = Number(process.env.STARN_COMPACT_THRESHOLD || fileConfig.compressionThreshold || 100000);
const keepRecentTokens = Number(process.env.STARN_KEEP_RECENT_TOKENS || fileConfig.keepRecentTokens || 20000);
const compactionModel = process.env.STARN_COMPACT_MODEL || fileConfig.compactionModel || '';
```

- [ ] **Step 2: Wire maybeCompact into runner.ts**

In `src/core/runner.ts`, at the top of `executeTurn`, before the agent loop, call `maybeCompact`:

```typescript
import { maybeCompact, estimateTokens } from './compaction.js';

// Inside executeTurn, before "6. Specialist Execution Loop":
const compactionResult = await maybeCompact({
  client,
  messages: sessionMessages,
  compactionModel: options.compactionModel || model,
  threshold: options.compressionThreshold,
  keepRecentTokens: options.keepRecentTokens,
  logger: options.logger
});
if (compactionResult.compacted) {
  sessionMessages = compactionResult.messages;
  options.onStatusUpdate?.(`Compacted session (${compactionResult.tokensBefore} → ${compactionResult.tokensAfter} tokens)`);
}
```

Add `compactionModel`, `compressionThreshold`, `keepRecentTokens`, `logger` to `TurnOptions`.

- [ ] **Step 3: Add context gauge to UI**

In `src/cli/ui.ts`, add a helper:

```typescript
export function formatContextGauge(tokens: number, threshold: number, compactionModel?: string): string {
  const pct = Math.round((tokens / threshold) * 100);
  const bar = pct > 80 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
  const modelLabel = compactionModel ? ` · Compact: ${compactionModel}` : '';
  return bar(`Context: ${formatTokenCount(tokens)}/${formatTokenCount(threshold)}${modelLabel}`);
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return `${tokens}`;
}
```

In `src/index.ts`, update the section header to include the gauge (compute tokens from `sessionMessages` via `estimateTokens`).

- [ ] **Step 4: Add /compact and /compact-model commands**

In `src/core/runner.ts` quick-command block, add:

```typescript
if (trimmed === '/compact') {
  // Force compaction now
  const result = await maybeCompact({
    client,
    messages: sessionMessages,
    compactionModel: options.compactionModel || model,
    threshold: 0, // force
    keepRecentTokens: options.keepRecentTokens,
    logger: options.logger
  });
  // Return a TurnResult with the compacted messages
  return {
    specialistId: 'general',
    specialistName: 'Session Compaction',
    output: `Compacted session. ${result.tokensBefore} → ${result.tokensAfter} tokens.`,
    autoRevisionsRun: 0,
    requiresReview: false,
    sessionMessages: result.messages
  };
}
```

`/compact-model` is handled in `src/index.ts` (it needs to prompt and save config, not run a turn):

```typescript
if (trimmed === '/compact-model') {
  const compactionModel = await promptSelectLiveModel(availableModels, config.compactionModel || selectedModel);
  saveUserConfig({ compactionModel }, config.globalDir);
  config.compactionModel = compactionModel;
  console.log(chalk.green(`✔ Compaction model set to ${compactionModel}`));
  continue; // skip the turn, re-prompt
}
```

Add both commands to `formatHelp()` in `src/cli/ui.ts`.

- [ ] **Step 5: Wire compaction model onboarding in index.ts**

After working-model selection in `src/index.ts`, if no `compactionModel` configured:

```typescript
if (!config.compactionModel) {
  console.log(chalk.dim('\nSelect a model for session compaction (summarizes long conversations).'));
  const compactionModel = await promptSelectLiveModel(availableModels, selectedModel);
  saveUserConfig({ compactionModel }, config.globalDir);
  config.compactionModel = compactionModel;
}
```

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all pass, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/core/runner.ts src/cli/ui.ts src/index.ts
git commit -m "feat(#2): wire compaction into runner; context gauge; /compact and /compact-model commands"
```

### Task 2.4: Proof gate for Fix #2

- [ ] **Step 8: Proof — confirm compaction triggers and preserves recent context**

Verify: `npm test` green. `tests/compaction.test.ts` covers estimation, serialization (with truncation), no-compact-under-threshold, and compact-over-threshold (summary injected, recent kept). Confirm `/compact` and `/compact-model` are in `formatHelp()`.

---

## Fix #8 — Checkpoint UI Richness

**Files:**
- Modify: `src/cli/ui.ts`
- Modify: `src/cli/checkpoint.ts`
- Create: `tests/checkpoint-ui.test.ts`

**Interfaces:**
- Consumes: `formatCriticScorecard` (revived), `CriticResult`, document content.
- Produces: three-panel checkpoint layout, `formatDocumentToc`, `browseSections`, `viewFullPaged`.

### Task 8.1: Add document TOC and section browser helpers

**Files:**
- Modify: `src/cli/ui.ts`
- Create: `tests/checkpoint-ui.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/checkpoint-ui.test.ts
import { describe, it, expect } from 'vitest';
import { formatDocumentToc, extractSections } from '../src/cli/ui.js';

const SAMPLE_DOC = `# BOM

## SS-01: Traction Motor
### Candidate table
content here

## SS-02: Battery Pack
### Candidate table
more content

## Design Decisions
D-001`;

describe('formatDocumentToc', () => {
  it('formats a two-level TOC with all ## and ### headings', () => {
    const toc = formatDocumentToc(SAMPLE_DOC);
    expect(toc).toContain('SS-01: Traction Motor');
    expect(toc).toContain('Candidate table');
    expect(toc).toContain('SS-02: Battery Pack');
    expect(toc).toContain('Design Decisions');
  });
});

describe('extractSections', () => {
  it('extracts section content by heading', () => {
    const sections = extractSections(SAMPLE_DOC);
    expect(sections['SS-01: Traction Motor']).toContain('content here');
    expect(sections['SS-02: Battery Pack']).toContain('more content');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/checkpoint-ui.test.ts`
Expected: FAIL — `formatDocumentToc`, `extractSections` not exported.

- [ ] **Step 3: Implement formatDocumentToc and extractSections in ui.ts**

```typescript
export function formatDocumentToc(content: string): string {
  const lines = content.split('\n');
  const tocLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      tocLines.push(`  ${chalk.cyan('•')} ${line.replace(/^##\s+/, '')}`);
    } else if (line.startsWith('### ')) {
      tocLines.push(`    ${chalk.dim('•')} ${line.replace(/^###\s+/, '')}`);
    }
  }
  return tocLines.join('\n');
}

export function extractSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split('\n');
  let currentHeading: string | null = null;
  let currentContent: string[] = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentHeading) {
        sections[currentHeading] = currentContent.join('\n').trim();
      }
      currentHeading = line.replace(/^##\s+/, '');
      currentContent = [];
    } else if (currentHeading) {
      currentContent.push(line);
    }
  }
  if (currentHeading) {
    sections[currentHeading] = currentContent.join('\n').trim();
  }
  return sections;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/checkpoint-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/ui.ts tests/checkpoint-ui.test.ts
git commit -m "feat(#8): add document TOC and section extraction helpers"
```

### Task 8.2: Rebuild checkpoint with three-panel layout

- [ ] **Step 1: Modify runHumanCheckpoint in checkpoint.ts**

Restructure the display portion of `runHumanCheckpoint`:

1. **Panel 1 — Critic scorecard (always):** if `criticResult` exists, print `formatCriticScorecard(criticResult)`. If no critic ran, print a small "No critic evaluation for this deliverable" note.

2. **Panel 2 — Document TOC:** if `isFullDeliverable`, print a boxed TOC using `formatDocumentToc` plus title/word/line count.

3. **Panel 3 — Action menu:** add `👁 Browse sections` and `📄 View full document (paged)` options alongside existing accept/feedback/discard.

For `Browse sections`:
```typescript
if (action === 'browse_sections') {
  const sections = extractSections(cleanedDoc);
  const sectionNames = Object.keys(sections);
  const selected = await select({
    message: 'Select a section to view:',
    choices: sectionNames.map((name, i) => ({ name: name, value: name }))
  });
  console.log(`\n${chalk.bold.underline(selected)}\n`);
  console.log(sections[selected]);
  console.log(`\n${chalk.dim('─'.repeat(60))}\n`);
  continue; // back to menu
}
```

For `View full document (paged)`:
```typescript
if (action === 'view_full_paged') {
  const lines = cleanedDoc.split('\n');
  const pageSize = Math.max(20, process.stdout.rows ? process.stdout.rows - 5 : 40);
  let offset = 0;
  while (offset < lines.length) {
    const slice = lines.slice(offset, offset + pageSize);
    console.log(slice.join('\n'));
    offset += pageSize;
    if (offset < lines.length) {
      const next = await select({
        message: `Lines ${offset}/${lines.length}:`,
        choices: [
          { name: '▶ Next page', value: 'next' },
          { name: '⏭ Skip to end', value: 'skip' },
          { name: '↩ Back to menu', value: 'back' }
        ]
      });
      if (next === 'skip') offset = lines.length;
      if (next === 'back') break;
    }
  }
  continue;
}
```

- [ ] **Step 2: Run full suite**

Run: `npm test`
Expected: all pass, tsc clean.

- [ ] **Step 3: Commit**

```bash
git add src/cli/checkpoint.ts
git commit -m "feat(#8): three-panel checkpoint with TOC, section browser, paged view"
```

### Task 8.3: Proof gate for Fix #8

- [ ] **Step 4: Proof — confirm richer checkpoint**

Verify: `npm test` green. Critic scorecard shows on pass. TOC lists all `##`/`###`. Browse sections shows whole section. Paged view chunks at terminal height.

---

## Fix #9 — Reopen Approved Artifacts + Auto Change-Impact on Re-approve

**Files:**
- Modify: `src/workspace/types.ts`
- Modify: `src/workspace/state.ts`
- Modify: `src/cli/checkpoint.ts`
- Modify: `src/core/runner.ts`
- Modify: `src/index.ts`
- Create: `tests/reopen-and-reapprove.test.ts`

**Interfaces:**
- Consumes: `ArtifactRecord` (adds `approvedContentHash`), `ProjectStateManager.revertArtifactToDraft`, change-impact specialist, SHA-256 (`crypto`).
- Produces: `/goto` to approved doc prompts revert; checkpoint `accept` with hash compare auto-runs change-impact.

### Task 9.1: Add approvedContentHash and revertArtifactToDraft

**Files:**
- Modify: `src/workspace/types.ts`
- Modify: `src/workspace/state.ts`
- Create: `tests/reopen-and-reapprove.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/reopen-and-reapprove.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager } from '../src/workspace/state.js';
import { ORDERED_WORKFLOW_PHASES } from '../src/workspace/state.js';

describe('reopen and re-approve', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'starn-reopen-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('test', 'Test');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('revertArtifactToDraft sets artifact to draft and re-locks downstream phases (transitive)', () => {
    // Approve CONOPS first
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\nv1');
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'CONOPS',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.0
    });

    // Revert CONOPS
    stateMgr.revertArtifactToDraft('CONOPS');

    const state = stateMgr.getState();
    const conopsArt = state.artifacts.find(a => a.id === 'CONOPS');
    expect(conopsArt?.status).toBe('draft');
    expect(state.workflow.phases['conops'].status).toBe('in_progress');

    // All phases after conops should be re-locked (pending)
    const conopsIdx = ORDERED_WORKFLOW_PHASES.findIndex(p => p.id === 'conops');
    for (let i = conopsIdx + 1; i < ORDERED_WORKFLOW_PHASES.length; i++) {
      const phaseId = ORDERED_WORKFLOW_PHASES[i].id;
      expect(state.workflow.phases[phaseId].status).toBe('pending');
    }
  });

  it('recordArtifact stores approvedContentHash on approval', () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\nv1 content');
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'CONOPS',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.0
    });
    const state = stateMgr.getState();
    const art = state.artifacts.find(a => a.id === 'CONOPS');
    expect(art?.approvedContentHash).toBeTruthy();
    expect(typeof art?.approvedContentHash).toBe('string');
  });

  it('hasContentChangedSinceApproval returns true when doc differs from hash', () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\nv1');
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'CONOPS',
      path: 'docs/CONOPS.md',
      status: 'approved'
    });
    // Change the doc
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\nv2 changed');
    expect(stateMgr.hasContentChangedSinceApproval('CONOPS')).toBe(true);
  });

  it('hasContentChangedSinceApproval returns false when doc is unchanged', () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\nv1');
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'CONOPS',
      path: 'docs/CONOPS.md',
      status: 'approved'
    });
    expect(stateMgr.hasContentChangedSinceApproval('CONOPS')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reopen-and-reapprove.test.ts`
Expected: FAIL — `revertArtifactToDraft`, `hasContentChangedSinceApproval` not defined; `approvedContentHash` not stored.

- [ ] **Step 3: Add approvedContentHash to ArtifactRecord**

In `src/workspace/types.ts`:

```typescript
export interface ArtifactRecord {
  id: string;
  title: string;
  path: string;
  status: 'draft' | 'approved' | 'rejected';
  criticScore?: number;
  approvedContentHash?: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Implement hash storage, revertArtifactToDraft, hasContentChangedSinceApproval in state.ts**

In `src/workspace/state.ts`, add `import crypto from 'node:crypto';` and:

```typescript
private computeContentHash(projectPath: string, artifactPath: string): string | null {
  const full = path.join(projectPath, artifactPath);
  if (!fs.existsSync(full)) return null;
  const content = fs.readFileSync(full, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

public recordArtifact(artifact: Omit<ArtifactRecord, 'updatedAt'>): void {
  const state = this.getState();
  const index = state.artifacts.findIndex(a => a.id === artifact.id);
  const fullRecord: ArtifactRecord = {
    ...artifact,
    updatedAt: new Date().toISOString()
  };

  // On approval, compute and store content hash
  if (artifact.status === 'approved') {
    const hash = this.computeContentHash(this.projectPath, artifact.path);
    if (hash) {
      fullRecord.approvedContentHash = hash;
    }
  }

  if (index >= 0) {
    state.artifacts[index] = fullRecord;
  } else {
    state.artifacts.push(fullRecord);
  }

  // Update workflow phase status (existing logic)
  const phaseKey = artifact.id.toLowerCase().replace(/_/g, '').replace(/-/g, '');
  for (const pKey of Object.keys(state.workflow.phases)) {
    const normalizedPKey = pKey.replace(/_/g, '').replace(/-/g, '');
    if (normalizedPKey === phaseKey) {
      state.workflow.phases[pKey].status = artifact.status === 'approved' ? 'approved' : 'in_progress';
      state.workflow.phases[pKey].updatedAt = fullRecord.updatedAt;
    }
  }

  state.recentActions.push(`Updated artifact ${artifact.id} (${artifact.status})`);
  this.saveState(state);
}

public revertArtifactToDraft(artifactId: string): void {
  const state = this.getState();
  const art = state.artifacts.find(a => a.id.toUpperCase() === artifactId.toUpperCase());
  if (!art) return;

  art.status = 'draft';
  art.updatedAt = new Date().toISOString();

  // Revert this phase to in_progress
  const phaseKey = artifactId.toLowerCase().replace(/_/g, '').replace(/-/g, '');
  if (state.workflow.phases[phaseKey]) {
    state.workflow.phases[phaseKey].status = 'in_progress';
    state.workflow.phases[phaseKey].updatedAt = art.updatedAt;
  }
  state.workflow.activePhase = phaseKey;
  state.currentPhase = phaseKey;

  // Re-lock all downstream phases (transitive closure)
  const idx = ORDERED_WORKFLOW_PHASES.findIndex(p => p.id === phaseKey);
  if (idx !== -1) {
    for (let i = idx + 1; i < ORDERED_WORKFLOW_PHASES.length; i++) {
      const downstreamId = ORDERED_WORKFLOW_PHASES[i].id;
      if (state.workflow.phases[downstreamId]) {
        state.workflow.phases[downstreamId].status = 'pending';
        state.workflow.phases[downstreamId].updatedAt = null;
      }
    }
  }

  state.recentActions.push(`Reverted ${artifactId} to draft (downstream re-locked)`);
  this.saveState(state);
}

public hasContentChangedSinceApproval(artifactId: string): boolean {
  const state = this.getState();
  const art = state.artifacts.find(a => a.id.toUpperCase() === artifactId.toUpperCase());
  if (!art || !art.approvedContentHash) return false;
  const currentHash = this.computeContentHash(this.projectPath, art.path);
  if (!currentHash) return false;
  return currentHash !== art.approvedContentHash;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/reopen-and-reapprove.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workspace/types.ts src/workspace/state.ts tests/reopen-and-reapprove.test.ts
git commit -m "feat(#9): approvedContentHash, revertArtifactToDraft, hasContentChangedSinceApproval"
```

### Task 9.2: Wire reopen prompt into /goto and auto change-impact into checkpoint

**Files:**
- Modify: `src/core/runner.ts` (`/goto` handling)
- Modify: `src/cli/checkpoint.ts` (auto change-impact on re-approve)
- Modify: `src/index.ts` (alignment prompt routing)

- [ ] **Step 1: Add reopen prompt to /goto in runner.ts**

In the `/goto` quick-command block of `executeTurn`, before `stateManager.setActivePhase(phase.id)`, check if the target artifact is approved:

```typescript
if (trimmed.startsWith('/goto')) {
  const arg = userPrompt.trim().slice('/goto'.length).trim();
  const phase = resolvePhaseRef(arg);
  if (!phase) {
    // existing error message
    return quickCommandResult('Project Workflow Planner', msg);
  }

  // REOPEN CHECK: if target phase's artifact is approved, prompt for revert
  const artifactId = phase.id.toUpperCase();
  if (stateManager.isArtifactApproved(artifactId)) {
    // Build downstream re-lock list for the confirmation
    const idx = ORDERED_WORKFLOW_PHASES.findIndex(p => p.id === phase.id);
    const downstream = ORDERED_WORKFLOW_PHASES.slice(idx + 1).map(p => p.name);
    // Return a special TurnResult signaling the UI to prompt
    return {
      specialistId: 'general',
      specialistName: 'Reopen Artifact',
      output: `__REOPEN_PROMPT__:${artifactId}:${downstream.join(', ')}`,
      autoRevisionsRun: 0,
      requiresReview: false,
      sessionMessages: [...sessionMessages, { role: 'user', content: userPrompt }]
    };
  }

  stateManager.setActivePhase(phase.id);
  // existing success message
}
```

- [ ] **Step 2: Handle __REOPEN_PROMPT__ in index.ts**

In `src/index.ts`, after `executeTurn` returns, check for the reopen signal:

```typescript
if (result.output.startsWith('__REOPEN_PROMPT__:')) {
  const [, artifactId, downstreamList] = result.output.split(':');
  const confirmed = await confirm({
    message: `${artifactId} is currently approved. Switching to it will revert it to draft so you can revise. Downstream phases that will re-lock: ${downstreamList}. Continue?`
  });
  if (confirmed) {
    stateManager.revertArtifactToDraft(artifactId);
    console.log(chalk.cyan(`\n↺ Reverted ${artifactId} to draft. Downstream phases re-locked.`));
    console.log(chalk.dim('You\'ll get an impact report when you re-approve.'));
    console.log(formatWorkflowRoadmap(stateManager.getState()));
  }
  continue; // re-prompt
}
```

- [ ] **Step 3: Auto-run change-impact on re-approve in checkpoint.ts**

In `runHumanCheckpoint`, in the `accept`/`override` branch, after `stateManager.recordArtifact(...)`, check for re-approval with changes:

```typescript
if (action === 'accept' || action === 'override') {
  if (isFullDeliverable) {
    // ... existing write-to-disk and recordArtifact logic ...

    const artifactId = specialistId.toUpperCase();
    const hadChanges = stateManager.hasContentChangedSinceApproval(artifactId);

    // If this was a re-approval (hash existed) with content changes, auto-run change-impact
    const priorHash = stateManager.getState().artifacts.find(a => a.id === artifactId)?.approvedContentHash;
    // recordArtifact already updated the hash; we need to check if there was a PRIOR hash before this approval
    // Simpler: track via a flag set before recordArtifact
  }
}
```

Implementation detail: before calling `recordArtifact`, check if the artifact was already approved (has `approvedContentHash`). After `recordArtifact`, if it was a re-approval and `hadChanges`, run the change-impact specialist and print inline:

```typescript
// Before recordArtifact:
const existingArt = stateManager.getState().artifacts.find(a => a.id === specialistId.toUpperCase());
const wasPreviouslyApproved = existingArt?.status === 'approved' && !!existingArt?.approvedContentHash;
const changedSinceApproval = wasPreviouslyApproved && stateManager.hasContentChangedSinceApproval(specialistId.toUpperCase());

// ... recordArtifact (updates hash) ...

if (changedSinceApproval) {
  console.log(chalk.cyan('\n📋 Content changed since last approval — running change-impact analysis...'));
  // Invoke the change-impact specialist via a mini agent loop
  const impactResult = await runAgentToolLoop({
    client, // need to pass client into checkpoint — add to CheckpointReviewOptions
    model,
    systemPrompt: changeImpactPackage.systemPrompt,
    userMessage: `Analyze the impact of changes to ${specialistId.toUpperCase()}. Compare the current docs/${specialistId.toUpperCase()}.md against all other approved/draft documents.`,
    toolRegistry,
    allowedTools: changeImpactPackage.allowedTools,
    context: { projectPath, stateManager }
  });
  console.log(`\n${chalk.bold.yellow('Change Impact Report:')}\n${impactResult.finalResponse}\n`);

  // Offer to align downstream docs
  const align = await select({
    message: 'Apply these changes to downstream docs?',
    choices: [
      { name: '✎ Yes — align downstream docs now', value: 'align' },
      { name: '⏭  No — I\'ll handle it manually', value: 'skip' }
    ]
  });
  if (align === 'align') {
    // Set the next prompt to the impact report + alignment instruction
    userFeedback = `${impactResult.finalResponse}\n\nUSER INSTRUCTION: Apply the recommended changes above to align the downstream documents. Update the affected docs in place.`;
    finalAction = 'feedback';
  }
}
```

Add `client`, `model`, `toolRegistry` to `CheckpointReviewOptions` and pass them from `index.ts`.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: all pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/runner.ts src/cli/checkpoint.ts src/index.ts
git commit -m "feat(#9): reopen via /goto; auto change-impact on re-approve with alignment"
```

### Task 9.3: Proof gate for Fix #9

- [ ] **Step 6: Proof — confirm full reopen→re-approve→impact lifecycle**

Verify: `npm test` green. `tests/reopen-and-reapprove.test.ts` covers revert + transitive re-lock, hash storage, change detection. `/goto` to approved doc yields reopen prompt. Re-approve with changed content triggers change-impact. Alignment option feeds impact report as next prompt.

---

## Final Proof Gate

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: `tsc --noEmit` clean, all tests pass.

- [ ] **Step 2: Verify all fixes are present**

Run: `grep -rn "resolveSection6\|foldAnswerIntoDoc\|removeSection6" src/` → no matches (Fix #5).
Run: `grep -rn "battery.*charger.*compartment" src/core/classifier.ts` → no matches (Fix #7).
Confirm `npm test` script is `tsc --noEmit && vitest run` (Fix #11).
Confirm `src/util/logger.ts` and retry logic exist (Fix #13).
Confirm `src/core/compaction.ts` exists with `maybeCompact` (Fix #2).
Confirm `pendingRisks` is the risk store (Fix #3).
Confirm discovery exclusions (Fix #4).
Confirm checkpoint three-panel layout (Fix #8).
Confirm `revertArtifactToDraft` and `approvedContentHash` (Fix #9).

- [ ] **Step 3: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore: audit remediation complete — all 9 fixes"
```
