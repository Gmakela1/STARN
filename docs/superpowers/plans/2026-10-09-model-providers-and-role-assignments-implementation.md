# Model Providers & Per-Role Assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each model role (drafting, critic, classifier, compaction) runs on OpenRouter or any OpenAI-compatible local provider, independently assigned.

**Architecture:** Generalize the OpenRouter client into `OpenAICompatClient` behind a `ChatClient` interface; config gains `providers` + `assignments` with legacy migration; `createRoleClients` builds per-role `{client, model, providerName}`; `TurnOptions` gains optional per-role client/model pairs that fall back to drafting.

**Tech Stack:** TypeScript strict, Node `fetch`, Vitest, React + Vite (web).

**Spec:** `docs/superpowers/specs/2026-10-09-model-providers-and-role-assignments-design.md`

## Global Constraints

- `core/*` must not import `cli/*` or `server/*`; new `src/models/*` imports no terminal libs.
- No new runtime npm dependencies.
- Built-in provider id `openrouter`, base URL `https://openrouter.ai/api/v1`; user ids may not be `openrouter`.
- `baseUrl` = API root; chat = `${baseUrl}/chat/completions`, list = `${baseUrl}/models`.
- No silent fallback between providers.
- Unreachable error text: `Provider "<name>" unreachable at <baseUrl>: <cause>`.
- Unknown provider text: `Config error: role "<role>" references unknown provider "<id>"`.
- Guard text: `Drafting model "<model>" on "<provider>" produced no document. It may not support tool calling. Reassign drafting in Settings or /models.`
- Gate per task: `npx tsc --noEmit && npx vitest run`; web tasks also `npm --prefix web run build`.

## Review Focus

- Base URL with trailing slash (`http://localhost:11434/v1/`) → no `//chat/completions` (Task 2).
- Removing a provider still assigned to a role → rejected naming the role (Task 5, Task 6).
- PUT settings omitting a provider `apiKey` → existing key kept, never echoed (Task 5).
- All roles on local providers and no OpenRouter key → CLI start does not demand an OpenRouter key (Task 6).
- Ollama root URL without `/v1` → Test connection error shows the URL tried (Task 3).

---

### Task 1: Config providers, assignments, migration; remove twin config; AGENTS.md

**Files:**
- Modify: `src/config.ts`, `AGENTS.md` (lines 81, 111, 118)
- Test: `tests/config-providers.test.ts` (new); `tests/config-settings.test.ts` (delete twin assertions/file if only twin)

**Interfaces — Produces:**
```ts
export const OPENROUTER_PROVIDER_ID = 'openrouter';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export type ModelRole = 'drafting' | 'critic' | 'classifier' | 'compaction';
export const MODEL_ROLES: ModelRole[];
export interface ProviderConfig { id: string; name: string; baseUrl: string; apiKey?: string }
export interface RoleAssignment { providerId: string; model: string }
export type Assignments = Record<ModelRole, RoleAssignment>;
export function resolveAssignments(file: UserConfigFile, env?: NodeJS.ProcessEnv): Assignments;
export function validateAssignments(a: Assignments, providers: ProviderConfig[]): void; // throws
// StarnConfig gains: providers: ProviderConfig[]; assignments: Assignments
// UserConfigFile gains: providers?: ProviderConfig[]; assignments?: Partial<Assignments>
```

- [x] **Step 1: Write failing tests** in `tests/config-providers.test.ts`:
  - `migrates legacy defaultModel/compactionModel to openrouter assignments`: file `{defaultModel:'a/m', compactionModel:'c/m'}` → drafting/critic/classifier `{providerId:'openrouter',model:'a/m'}`, compaction `{...,'c/m'}`.
  - `compaction falls back to defaultModel`.
  - `keeps explicit assignments`: file assignments critic `{providerId:'ollama',model:'qwen'}` preserved.
  - `env STARN_MODEL overrides openrouter roles only`: critic on `ollama` unchanged.
  - `validateAssignments throws naming role and provider` (exact text from Global Constraints).
  - `loadConfig returns providers [] by default and no digitalTwin* keys`.
- [x] **Step 2: Run** `npx vitest run tests/config-providers.test.ts` → FAIL (exports missing).
- [x] **Step 3: Implement** in `src/config.ts`. `loadConfig` calls `resolveAssignments` then `validateAssignments`. Env: `STARN_MODEL` (and existing `OPENROUTER_MODEL`) override openrouter-provider drafting/critic/classifier models; `STARN_COMPACT_MODEL` compaction. `defaultModel` = drafting model, `compactionModel` = compaction model (kept for existing callers). Remove `digitalTwin*` fields and `STARN_TWIN_*` env reads.
- [x] **Step 4: Update AGENTS.md:** line 81 → "Native function calling via OpenRouter or any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp server). Each model role (drafting, critic, classifier, compaction) is assigned a provider + model."; line 111 "OpenRouter only" → "OpenRouter + OpenAI-compatible local providers"; replace line 118 with "- Launching or managing local model servers (STARN connects to them; it does not start them)".
- [x] **Step 5: Run** full gate. Fix compile errors from removed twin fields **only in `src/config.ts` consumers by deleting twin usages** (`src/index.ts`, `src/server/session.ts`, `src/server/router.ts`, `src/server/types.ts`, `src/cli/prompts.ts` `promptDigitalTwinSettings` + `/twin-model` handler). Expected: PASS.
- [x] **Step 6: Commit** `feat(config): providers + per-role assignments with legacy migration; drop dead twin model settings`

### Task 2: `OpenAICompatClient` + `ChatClient`

**Files:**
- Modify: `src/openrouter/client.ts`, `src/openrouter/types.ts`
- Test: `tests/openai-compat-client.test.ts` (new)

**Interfaces — Produces:**
```ts
// types.ts
export interface ChatClient { chatCompletion(o: ChatCompletionOptions): Promise<ChatCompletionResult> }
// ChatCompletionOptions gains: tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
// client.ts
export interface OpenAICompatClientOptions { providerName: string; baseUrl: string; apiKey?: string; openRouterHeaders?: boolean; siteUrl?: string; appName?: string; logger?: Logger }
export class OpenAICompatClient implements ChatClient { readonly providerName: string; readonly baseUrl: string }
export class OpenRouterClient extends OpenAICompatClient // ctor(OpenRouterClientOptions) unchanged; providerName 'OpenRouter', openRouterHeaders true, baseUrl default OPENROUTER_BASE_URL
```

- [x] **Step 1: Failing tests** (stub `globalThis.fetch` with `vi.fn`):
  - `posts to <baseUrl>/chat/completions and strips trailing slash` (baseUrl `http://h:1/v1/` → `http://h:1/v1/chat/completions`).
  - `omits Authorization when no apiKey`; `omits HTTP-Referer/X-Title unless openRouterHeaders`.
  - `passes tool_choice through`.
  - `network failure → Provider "Ollama" unreachable at http://h:1/v1: <cause>` (fetch rejects `TypeError('fetch failed')`; retries exhausted — inject `backoffMs` via a test-only subclass or `vi.useFakeTimers`).
  - `OpenRouterClient without key still throws OPENROUTER_API_KEY is not configured.`
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement.** Move retry/request logic into `OpenAICompatClient`; non-OK error prefix `${providerName} API error (${status})`. `transcribeAudio` stays on `OpenRouterClient`, URL `${baseUrl}/audio/transcriptions`. Wrap fetch rejection (non-Abort) into the unreachable message after retries.
- [x] **Step 4: Run** full gate (existing `openrouter*.test.ts` must still pass) → PASS.
- [x] **Step 5: Commit** `feat(client): provider-agnostic OpenAI-compatible client`

### Task 3: Role clients, model listing, tool-call probe

**Files:**
- Create: `src/models/role-clients.ts`, `src/models/provider-models.ts`
- Test: `tests/role-clients.test.ts`, `tests/provider-models.test.ts`

**Interfaces:**
- Consumes: Task 1 types, Task 2 `ChatClient`, `OpenAICompatClient`, `OpenRouterClient`.
- Produces:
```ts
export interface RoleClient { client: ChatClient; model: string; providerName: string }
export type RoleClients = Record<ModelRole, RoleClient>;
export function allProviders(apiKey: string, providers: ProviderConfig[]): ProviderConfig[]; // built-in first
export function createRoleClients(cfg: { apiKey: string; providers: ProviderConfig[]; assignments: Assignments; siteUrl?: string; appName?: string; logger?: Logger },
  factory?: (p: ProviderConfig) => ChatClient): RoleClients;
export function listProviderModels(p: ProviderConfig): Promise<string[]>;
export function probeToolCalling(client: ChatClient, model: string): Promise<{ ok: boolean; detail: string }>;
```

- [x] **Step 1: Failing tests:**
  - `one client per provider shared across roles` (factory call count = distinct providers used).
  - `roles map to assigned model and providerName`.
  - `listProviderModels returns data[].id from GET <baseUrl>/models`; `error message includes URL tried` on 404/ECONNREFUSED.
  - `probe ok when tool_calls contains ping`; `probe not ok when content only` (detail `"Model returned text, not a tool call"`); `probe not ok on throw` (detail = error message). Assert request had `tool_choice: {type:'function',function:{name:'ping'}}`.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement.** Built-in `openrouter` → `OpenRouterClient`; others → `OpenAICompatClient`. Probe: user message `"Call the ping tool."`, tool `ping` with `parameters: {type:'object',properties:{}}`, `max_tokens: 32`.
- [x] **Step 4: Run** full gate → PASS.
- [x] **Step 5: Commit** `feat(models): role clients, provider model listing, tool-call probe`

### Task 4: Runner per-role wiring + drafting guard

**Files:**
- Modify: `src/core/runner.ts`, `src/core/critic.ts`, `src/core/classifier.ts`, `src/core/compaction.ts`, `src/core/agent-loop.ts`, `src/cli/checkpoint.ts` (types `OpenRouterClient` → `ChatClient`)
- Test: `tests/role-routing.test.ts`, `tests/drafting-guard.test.ts`

**Interfaces — Produces** (`TurnOptions` additions; `TurnResult.error?: boolean`):
```ts
criticClient?: ChatClient; criticModel?: string;
classifierClient?: ChatClient; classifierModel?: string;
compactionClient?: ChatClient;            // compactionModel exists
draftingProviderName?: string;
```

- [x] **Step 1: Failing tests** (setup copied from `tests/core-loop.test.ts`, three plain `{ chatCompletion: vi.fn() }` fakes):
  - `classifier uses classifierClient/classifierModel`.
  - `critic uses criticClient/criticModel` (CONOPS intake completed, drafting returns `# Concept…` doc).
  - `/compact uses compactionClient`.
  - `falls back to client/model when role fields unset` (single client receives all calls, all with `test-model`).
  - Guard: drafting returns `content: 'Sure, I will do that.'`, no file written → `result.error === true`, `output` = guard text with model + provider, critic fake not called.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement.** Replace classify/critic/compaction call sites per spec §2; critic `evaluate({ model: criticModel ?? model, … })`. Guard placed after `artifactForCritic` computation inside `if (specialist.requiresCritic)`: condition `!editUsed && !diskModified && !finalOutput.includes('# ')`; `draftingProviderName ?? 'OpenRouter'`.
- [x] **Step 4: Run** full gate → PASS.
- [x] **Step 5: Commit** `feat(core): per-role model routing and no-document drafting guard`

### Task 5: Server session + settings/provider API

**Files:**
- Modify: `src/server/session.ts`, `src/server/router.ts`, `src/server/types.ts`, `src/server/server.ts` (if `onSettingsSaved` type lives there)
- Test: `tests/server-api.test.ts` (update session construction), `tests/server-settings.test.ts` (new)

**Interfaces:**
- Consumes: Task 1, Task 3.
- Produces:
```ts
// SessionDeps: replace client/model/compactionModel/twin fields with
apiKey: string; providers: ProviderConfig[]; assignments: Assignments; clientFactory?: (p: ProviderConfig) => ChatClient;
// ServerSessionManager
get providers(): ProviderConfig[]; get assignments(): Assignments;
get model(): string; get compactionModel(): string;   // derived
applySettings(u: { providers?: ProviderConfig[]; assignments?: Partial<Assignments> }): void; // validates, rebuilds role clients; throws on invalid
// types.ts
export interface ProviderView { id: string; name: string; baseUrl: string; hasKey: boolean; builtIn: boolean }
export interface SettingsResponse { providers: ProviderView[]; assignments: Assignments; port: number; projectPath: string; probe?: { ok: boolean; detail: string } }
// onSettingsSaved(s: { providers: ProviderConfig[]; assignments: Assignments })
```

- [x] **Step 1: Failing tests** (`tests/server-settings.test.ts`, `clientFactory` returns fakes):
  - `GET /api/settings lists openrouter first, masks keys` (no `apiKey` anywhere in raw body; `hasKey` true for keyed provider).
  - `PUT unknown provider → 400 naming role`; `PUT provider id openrouter → 400`; `PUT duplicate id → 400`.
  - `PUT removing an assigned provider → 400 naming role`.
  - `PUT provider without apiKey keeps existing key` (verify via `onSettingsSaved` payload).
  - `PUT drafting change returns probe` (fake returns tool call → `probe.ok` true).
  - `GET /api/providers/:id/models` → `{ models }`; unreachable → 502 with URL.
  - `POST /api/providers/:id/probe` → `{ ok, detail }`; unknown id → 404.
  - `runTurn passes per-role clients` (critic fake called during a CONOPS turn).
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement.** `runTurn` passes `client/model` = drafting, plus critic/classifier/compaction pairs and `draftingProviderName`. `POST /api/settings` routes to the PUT handler. `buildProjectInfo.models` uses derived getters.
- [x] **Step 4: Run** full gate → PASS.
- [x] **Step 5: Commit** `feat(server): providers + assignments settings API with key masking and probe`

### Task 6: CLI wiring + `/models`

**Files:**
- Modify: `src/index.ts`, `src/cli/prompts.ts`, `src/cli/ui.ts` (help text if commands listed), `src/core/formatters.ts` (help text)
- Test: `tests/cli-models.test.ts` (new; pure helpers only)

**Interfaces — Produces** (`src/cli/prompts.ts`):
```ts
export function formatAssignments(a: Assignments, providers: ProviderConfig[]): string; // lines "drafting · OpenRouter · a/m"
export function assignedRolesFor(providerId: string, a: Assignments): ModelRole[];
export function needsOpenRouterKey(a: Assignments): boolean;
export async function promptModelsMenu(cfg: StarnConfig, openRouterModels: ModelOption[]): Promise<{ providers: ProviderConfig[]; assignments: Assignments; probe?: { ok: boolean; detail: string } } | null>;
```

- [x] **Step 1: Failing tests:** `formatAssignments` exact lines; `assignedRolesFor` returns roles; `needsOpenRouterKey` false when all roles local.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement.**
  - Startup: prompt for OpenRouter key only if `needsOpenRouterKey`; fetch OpenRouter models only if key present. Initial model prompt sets drafting (and compaction onboarding) only when those roles are on `openrouter`.
  - Build `roleClients = createRoleClients(config…)`; pass role pairs into every `CoreRunner.executeTurn`, `ServerSessionManager` (new deps), and `runHumanCheckpoint` (drafting client/model).
  - `/models`: print `formatAssignments`, menu Reassign role / Add provider / Remove provider / Done. Remove refuses with `Provider "<name>" is assigned to: <roles>` when `assignedRolesFor` non-empty. Reassign drafting runs `probeToolCalling`; on fail print yellow warning with `detail`. Persist `{providers, assignments, defaultModel, compactionModel}` via `saveUserConfig`; rebuild `roleClients`.
  - `/compact-model`: reassign compaction model on its current provider.
  - Help text: add `/models`, remove `/twin-model`.
- [x] **Step 4: Run** full gate → PASS.
- [x] **Step 5: Commit** `feat(cli): /models provider + role assignment management`

### Task 7: Web Settings — Providers & Assignments

**Files:**
- Modify: `web/src/types/api.ts`, `web/src/api/client.ts`, `web/src/views/SettingsView.tsx`, `web/src/views/DashboardView.tsx` (if it reads twin/agentModel settings)

**Interfaces — Consumes:** Task 5 `SettingsResponse`, `ProviderView`, routes.
- `api.fetchSettings(): Promise<SettingsResponse>`, `api.saveSettings(body): Promise<SettingsResponse>` (PUT), `api.listProviderModels(id)`, `api.probeProvider(id, model)`.

- [x] **Step 1: Implement** per spec §5: Providers card (OpenRouter read-only row; user rows: name, base URL, password key input with placeholder `unchanged` when `hasKey`, Test connection → `N models` or error text, Remove; Add provider defaults `Ollama` / `http://localhost:11434/v1`); Assignments card (4 rows, provider select + model select from `listProviderModels`, text input on failure; critic note "The critic gates every deliverable; assign your strongest model."). Save → show `probe.ok === false` warning with `detail`; show server 400 message. Controls `min-h-[44px]`, every input has `<label htmlFor>`. Remove Digital Twin model section and twin state.
- [x] **Step 2: Run** `npm --prefix web run build` → exit 0, then full gate.
- [x] **Step 3: Live smoke:** start `startWebServer` on a temp project with a fake provider; `curl GET /api/settings` shows no `apiKey`; PUT invalid → 400. Record command output.
- [x] **Step 4: Commit** `feat(web): providers and model assignments settings`

### Task 8: Final verification

- [x] **Step 1:** `npx tsc --noEmit && npx vitest run && npm --prefix web run build` — record file/test counts, 0 failures.
- [x] **Step 2:** `grep -rn "digitalTwinModel\|digitalTwinProvider\|digitalTwinBaseUrl\|twin-model" src web/src tests` → no matches.
- [x] **Step 3:** `grep -rn "from '../cli\|from '../server" src/core src/models` → no matches.
- [x] **Step 4:** Mark plan checkboxes; commit `docs(plan): mark model providers plan complete`; push `origin/master`.
