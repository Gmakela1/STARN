# Model Providers & Per-Role Assignments — Design

**Status:** Approved in brainstorming (2026-10-09). Sub-project 2 of the redesign.

## Goal

Let every model-using role run on OpenRouter or any OpenAI-compatible local
server (Ollama, LM Studio, llama.cpp server), each role independently assigned.
STARN never launches or manages local servers.

## Decisions

| # | Decision |
|---|---|
| 1 | AGENTS.md: replace "OpenRouter only" with "OpenRouter + OpenAI-compatible endpoints"; remove "Local model serving" from Out of Scope; add "STARN does not launch/manage local servers". |
| 2 | Four roles: **drafting** (all specialists + intake), **critic**, **classifier**, **compaction**. No per-specialist overrides. |
| 3 | OpenRouter (built-in) + N named user providers. |
| 4 | Tool-call probe warns on failure; save still allowed. Runtime guard reports a no-document drafting turn as an error. |
| 5 | Unreachable provider fails the turn with provider name + URL. No silent fallback. |
| 6 | Wiring: per-role fields on `TurnOptions` (no router abstraction). |
| 7 | Remove dead digital-twin model settings (`digitalTwinModel/Provider/BaseUrl`, `/twin-model`, Settings twin section). |
| 8 | Voice transcription stays on OpenRouter. |

## 1. Config & data model (`src/config.ts`)

```ts
export interface ProviderConfig { id: string; name: string; baseUrl: string; apiKey?: string }
export interface RoleAssignment { providerId: string; model: string }
export type ModelRole = 'drafting' | 'critic' | 'classifier' | 'compaction';

// StarnConfig / UserConfigFile gain:
providers: ProviderConfig[];                       // user providers only
assignments: Record<ModelRole, RoleAssignment>;
```

- Built-in provider id `openrouter`: base URL `https://openrouter.ai/api/v1`, key = existing `apiKey`. Never stored in `providers`; user ids may not be `openrouter`.
- `baseUrl` is the API root (e.g. `http://localhost:11434/v1`); clients append `/chat/completions` and `/models`.
- **Migration on load** (pure function `resolveAssignments(file)`):
  - missing `drafting|critic|classifier` → `{ openrouter, defaultModel }`
  - missing `compaction` → `{ openrouter, compactionModel || defaultModel }`
  - missing `providers` → `[]`
- Env overrides: `STARN_MODEL` sets the model of drafting, critic, classifier when their provider is `openrouter`; `STARN_COMPACT_MODEL` likewise for compaction.
- **Validation:** an assignment referencing an unknown provider id throws `Config error: role "<role>" references unknown provider "<id>"`.
- `defaultModel`/`compactionModel` remain readable for migration and are written in sync with the drafting/compaction assignment so older builds still start.
- Remove `digitalTwinModel`, `digitalTwinProvider`, `digitalTwinBaseUrl` (types, load, save, session, router, web types).

## 2. Clients & wiring

### `src/openrouter/client.ts`
- New `OpenAICompatClient({ providerName, baseUrl, apiKey?, ...retryOpts })`.
  - Chat URL = `${baseUrl}/chat/completions`. `Authorization` header only if `apiKey`.
  - OpenRouter-only headers (`HTTP-Referer`, `X-Title`) only when option `openRouterHeaders: true` (set by `OpenRouterClient`).
  - `ChatCompletionOptions` gains optional `tool_choice` (passed through to the payload).
  - Existing retry/backoff unchanged.
  - Network failure → `Error("Provider \"<name>\" unreachable at <baseUrl>: <cause>")`. Non-2xx after retries → message includes provider name.
  - No empty-key throw for keyless providers.
- `OpenRouterClient extends OpenAICompatClient` (preserves current constructor, `transcribeAudio`, imports). Its `baseUrl` option changes from full chat URL to API root; no caller passes it today (verified by grep).
- Shared interface `ChatClient { chatCompletion(o): Promise<ChatCompletionResult> }`; core modules type against `ChatClient`.

### `src/models/role-clients.ts` (new, no I/O libs)
```ts
export interface RoleClient { client: ChatClient; model: string; providerName: string }
export function createRoleClients(cfg: { apiKey: string; providers: ProviderConfig[]; assignments: Record<ModelRole, RoleAssignment> },
  factory?: (p: ProviderConfig) => ChatClient): Record<ModelRole, RoleClient>;
```
One client instance per provider, shared across roles.

### `src/models/provider-models.ts` (new)
- `listProviderModels(provider): Promise<string[]>` — `GET ${baseUrl}/models`, returns `data[].id`. OpenRouter keeps `fetchLiveOpenRouterModels`.
- `probeToolCalling(client, model): Promise<{ ok: boolean; detail: string }>` — one request with a `ping` tool (no params), `tool_choice: { type: 'function', function: { name: 'ping' } }`, `max_tokens` small. `ok` iff a `tool_calls` entry named `ping` is returned. Errors → `ok:false` with message.

### `TurnOptions` (`src/core/runner.ts`)
```ts
client: ChatClient; model: string;               // drafting + intake (existing)
criticClient?: ChatClient;     criticModel?: string;
classifierClient?: ChatClient; classifierModel?: string;
compactionClient?: ChatClient; compactionModel?: string;  // compactionModel exists
draftingProviderName?: string;                   // for guard error text
```
Each optional pair falls back to `client` / `model`.

- `classifyRequest(classifierClient ?? client, classifierModel ?? model, …)`
- `new CriticEvaluator(criticClient ?? client)` with `criticModel ?? model`
- `compactMessages({ client: compactionClient ?? client, compactionModel: compactionModel ?? model, … })` (both call sites)
- `CriticEvaluator`, `classifyRequest`, `compactMessages`, `runAgentToolLoop` parameter types: `OpenRouterClient` → `ChatClient`.

### Callers
- `src/index.ts`: build role clients at start and after any settings change; pass into `TurnOptions`. Voice keeps its own `OpenRouterClient`.
- `src/server/session.ts`: holds `providers`, `assignments`, role clients; `setProviders`, `setAssignment(role, a)` rebuild clients. Replaces `setModel`/`setCompactionModel`/twin setters (keep `model`/`compactionModel` getters derived from assignments for existing callers).

## 3. Runtime guard

In `runner.ts`, after the agent loop for a `requiresCritic` specialist: if the target doc was not modified this turn (`!editUsed && !diskModified`) **and** `finalOutput` has no `# ` heading, return without running the critic:

```
output: 'Drafting model "<model>" on "<provider>" produced no document. It may not support tool calling. Reassign drafting in Settings or /models.'
requiresReview: false, error: true
```
`TurnResult` gains optional `error?: boolean`. Intake and non-critic specialists are unaffected.

## 4. API (`src/server/router.ts`, `types.ts`)

- `GET /api/settings` → `{ providers: Array<Provider & { hasKey: boolean }> (apiKey omitted), assignments, port, projectPath }`. Built-in OpenRouter listed first with `builtIn: true`.
- `PUT /api/settings` body `{ providers?, assignments? }`:
  - validates (unknown provider → 400 naming the role; duplicate/`openrouter` id → 400);
  - provider `apiKey` omitted in body = keep existing; empty string = clear;
  - applies to session, persists via `onSettingsSaved`, returns same shape as GET plus `probe?: { ok, detail }` when the drafting assignment changed.
- `POST /api/settings` kept as alias of `PUT` (existing web client).
- `GET /api/providers/:id/models` → `{ models: string[] }`; unreachable → 502 with provider/URL message.
- `POST /api/providers/:id/probe` body `{ model }` → `{ ok, detail }`.

## 5. Web UI (`web/src/views/SettingsView.tsx`)

- **Providers** card: OpenRouter row (read-only, key status). User rows: name, base URL, key (password input, placeholder "unchanged" when `hasKey`), Test connection (lists model count or error), Remove. Add provider button (defaults name "Ollama", URL `http://localhost:11434/v1`).
- **Model assignments** card: rows Drafting / Critic / Classifier / Compaction — provider select + model select (from `/models`; falls back to text input on fetch failure). Critic row note: "The critic gates every deliverable; assign your strongest model." Save shows probe warning inline if `probe.ok === false`.
- Remove Digital Twin model section. 44px controls, labels bound to inputs.

## 6. CLI (`src/index.ts`, `src/cli/prompts.ts`)

- `/models`: prints the four assignments (`role · provider · model`), then menu: Reassign role / Add provider / Remove provider / Done. Reassign: pick role → provider → model (live list; manual entry on failure) → probe if drafting, print warning on failure. Persist via `saveUserConfig`.
- `/compact-model`: shortcut to reassign compaction on its current provider.
- Remove `/twin-model` and `promptDigitalTwinSettings`.
- Session header gauge shows drafting model (unchanged) — no new header noise.

## 7. Errors

| Case | Behavior |
|---|---|
| Provider unreachable mid-turn | Turn fails; message names provider + URL; state preserved; loop continues. |
| Unknown provider in config | Startup error naming role and id. |
| `/models` fetch fails | Manual model entry offered. |
| Probe fails | Warning; save allowed. |
| Drafting produced nothing | Guard error (§3). |

## 8. Testing (TDD)

- `config-providers.test.ts`: migration from legacy fields; env overrides; unknown provider throws; save writes legacy mirrors; twin fields gone.
- `role-clients.test.ts`: one client per provider; roles map to correct model/provider.
- `role-routing.test.ts`: fake `ChatClient` per role; runner calls classifier/critic/compaction/drafting each with its own client and model; fallbacks when unset.
- `provider-models.test.ts`: `/models` parsing; probe ok / no tool call / HTTP error (fetch stubbed).
- `openai-compat-client.test.ts`: URL building, no auth header without key, unreachable error text.
- `drafting-guard.test.ts`: no write + no heading → error, critic not called.
- `server-api.test.ts`: settings GET masks keys; PUT validation 400s; probe/models routes.
- Existing suite stays green; `tsc --noEmit`; `npm --prefix web run build`.

## Out of scope

Per-specialist model overrides; digital-twin model role; launching local servers; fallback routing; voice on local providers.
