# STARN

AI project management agent for physical/hardware projects (solar sheds,
outdoor structures, deployable systems, maker/construction work). Helps
users create and refine foundational project documents and plans with
strong process discipline and quality control.

**Current surface:** terminal CLI. **Future surface:** web application.
The architecture must keep core agent logic decoupled from I/O so the
presentation layer is swappable.

## First Principles (non-negotiable)

- Start simple. Ship a sharp, high-quality MVP before adding features.
- The main AI agent does the real work. Avoid over-engineering multi-agent complexity.
- Continuous agentic looping with human-on-the-loop is required.
- A harsh critic stage is mandatory for high-value artifacts.
- Explicit project discovery is mandatory before significant work.
- Status must be persisted and visible across loops and sessions.
- Prefer clarity, reliability, and quality over features.
- Tools are strictly scoped per specialist package. The main agent must never have unrestricted access to all tools.
- **Core logic stays I/O-agnostic.** The agent loop, specialists, critic, classifier, compaction, state, and tools must not depend on terminal libraries (`chalk`, `boxen`, `@inquirer/prompts`, `ora`). Terminal/HTTP/WebSocket presentation is a replaceable adapter layer. Never let `core/*` import from `cli/*`.

## Core Flow (every request)

1. Classify the request and select the appropriate specialist package.
2. Load specialist package (system instructions, allowed tools, quality criteria, examples).
3. Discover current project state (mandatory).
4. Execute via a tool-use loop (model decides actions, calls tools, continues until done or needs input).
5. Critic stage (mandatory for high-value outputs). Harsh evaluation against quality examples + explicit criteria. Only accept on pass (or human override).
6. Update and persist status.
7. Present results and wait for human input/approval at checkpoints.

## Specialist Packages

The workflow is an ordered chain of specialist deliverables. Each produces
one approved document that gates the next phase:

CONOPS → Architecture → ICD → Capabilities → Requirements → BOM → RTM →
Milestones → Risk Register → Build Sequence → Test Plans → SOW

Plus **Change Impact** (cross-cutting, no artifact of its own) and
**General** (Q&A, summaries, no file writes).

Each package contains: focused system prompt, strictly limited tool
allow-list, critic rubric, and secret-sauce quality examples.

## Discovery (critical)

Before meaningful work the agent must inspect the project: existing
documents, decisions already made, current phase, open risks and
constraints, and the structured project state file. Feed a concise
summary back into the main agent context.

Discovery scans the project folder but excludes dev artifacts
(`dist`, `tests`, `testbed`, `.git`, lockfiles, logs) to keep context clean.

## Critic (non-negotiable)

After drafting a high-value artifact:
- Critic receives the artifact, quality examples, explicit grading criteria, and the approved program baseline (upstream docs) for cross-document alignment.
- Apples-to-oranges quality judgment: evaluate standard of quality, format, critical thinking, reasonableness, and professionalism — not content identity.
- Anti-hallucination: penalize invented vendor brands, part numbers, or unrequested subsystems.
- Pass only if it meets or exceeds the bar. Otherwise return clear, actionable feedback and loop (auto-revisions, then human intervention).
- Human can always override or give additional guidance.

Quality examples: developer provides "secret sauce" examples per
specialist; users may drop their own into `examples/<specialist>/`. The
critic extracts and applies the quality standard; it must not copy content.

## Human-on-the-loop & Persistence

- Continuous loop. After significant steps or when input is needed, pause at checkpoints, show status, and save state.
- User can approve, reject, give feedback, stop, or undo.
- Checkpoints appear **only** when a specialist completes a critic-gated draft — not for quick commands, intake questions, or conversational replies.
- Persist after every meaningful turn: current specialist, discovery summary, artifacts (with content hashes), critic results, open questions, progress. File-based is fine; a session store (Redis/DB) is the web equivalent.
- Reopening an approved artifact re-locks its downstream phases (transitive) and, on re-approval with content changes, auto-runs change-impact analysis.

## Tools (strictly scoped)

Native function calling via OpenRouter only. Scope tools per specialist
allow-list:

- List directory / Read file / Write file (path-traversal-guarded, project-rooted)
- Read project state / Update project state (Zod-validated)
- List & read quality examples
- PDF text extraction

No unrestricted shell or broad filesystem access. For multi-tenant web,
tools must be sandboxed (per-project jail or virtual FS) — the handler
interfaces (`ToolExecutionContext`) already allow swapping implementations
without touching the agent loop.

## Context Management & Reliability

- **Compaction:** when session context exceeds a configurable threshold, summarize older messages (structured format) and keep recent ones. Configurable compaction model, independent of the working model.
- **Retry:** OpenRouter calls retry with exponential backoff on 429/5xx, respecting `Retry-After`.
- **Logging:** structured file logs per project for post-mortem diagnosis.
- **Type safety:** `tsc --noEmit` runs in the test pipeline. Type errors fail the build.

## Test Bed (build in parallel)

`testbed/` supports autonomous end-to-end testing with live OpenRouter
API calls: realistic test prompts, per-test grading criteria, and a
runner that captures outputs/intermediate steps and grades response
quality (including critic behavior). Tests validate the system as a
whole, not only isolated units.

## Technical Preferences

- Language: TypeScript (strict). OpenRouter only. Config via env vars + `~/.starn/config.json`.
- Clean separation: core agent loop, specialist packages, tools, state, critic, **presentation layer** (terminal today, web tomorrow).
- Core modules must compile and run with zero terminal-library imports.

## Out of Scope (current surface)

- Slack or any chat platform
- Local model serving (pi / llama.cpp)
- Web search
- Complex multi-agent swarms
- Auth / multi-user (until web migration)
- Automatic internet research

## Success Criteria

- User can start the app, select a model (and a compaction model), point at a project folder, and request any specialist deliverable.
- Agent classifies, loads specialist context, discovers existing state, drafts, runs critic against quality examples with program-baseline alignment, and only presents high-quality results (or clear feedback).
- Loop-based with clear human checkpoints and persisted status; roadmap reconciles with artifacts on every load.
- Autonomous test bed exercises main flows with live OpenRouter calls and quality grading.
- Core logic is presentation-agnostic: a web UI can replace the terminal adapter without touching `core/*`.

## Implementation Order

1. Project skeleton + OpenRouter integration + model selection
2. Agentic tool-use loop
3. Project state + discovery tools
4. Specialist package loading
5. Critic stage with quality examples
6. Presentation loop (terminal now; HTTP/WebSocket later) with human-on-the-loop
7. Test bed + first E2E tests (live OpenRouter quality evaluation)
8. Context compaction, retry, logging, type-gated tests
9. Polish, error handling, status visibility

Start simple. Make the MVP sharp and reliable. Do not add features outside the flow above.
