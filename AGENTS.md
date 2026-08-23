# STARN

Terminal-based AI project management agent for physical/hardware projects
(solar sheds, outdoor structures, deployable systems, maker/construction work).

Helps users create and refine foundational project documents and plans with
strong process discipline and quality control.

## First Principles (non-negotiable)

- Start simple. Ship a sharp, high-quality MVP before adding features.
- The main AI agent does the real work. Avoid over-engineering multi-agent complexity in v1.
- Continuous agentic looping with human-on-the-loop is required.
- A harsh critic stage is mandatory for important artifacts.
- Explicit project discovery is mandatory before significant work.
- Status must be persisted and visible across loops.
- Prefer clarity, reliability, and quality over features.
- Tools are strictly scoped per specialist package. The main agent must never have unrestricted access to all tools.

## Core Flow (every request)

1. Classify the request and select the appropriate specialist package.
2. Load specialist package (system instructions, allowed tools, quality criteria, templates/examples).
3. Discover current project state (mandatory).
4. Execute via Claude-Code-style tool-use loop (model decides actions, calls tools, continues until done or needs input).
5. Critic stage (mandatory for high-value outputs). Harsh evaluation against quality examples + explicit criteria. Only accept on pass (or human override).
6. Update and persist status.
7. Present results and wait for human input/approval at checkpoints.

## Specialist Packages (v1 – start with these only)

- CONOPS / User's Intent
- Product Capabilities and Requirements
- Milestones / Key phase requirements and gating criteria (MVP, IOC, etc.)
- WBS / Work Breakdown

Each package must contain:
- Focused system prompt/instructions
- Strictly limited tool allow-list
- Quality criteria for the critic
- References to quality examples

## Discovery (critical)

Before meaningful work the agent must inspect the project. Prioritize:
- Existing documents
- Decisions already made
- Current phase
- Open risks and constraints
- Material/status notes
- Structured project state file

Feed a concise summary back into the main agent context.
Discovery tools: list files, read key documents, read project state.
Do **not** implement web search in v1.

## Critic (non-negotiable)

After drafting a high-value artifact:
- Critic receives the artifact, user/developer quality examples, and explicit grading criteria.
- Perform apples-to-oranges quality judgment: evaluate standard of quality, format, critical thinking, reasonableness, and professionalism — not content identity.
- Pass only if it meets or exceeds the bar. Otherwise return clear, actionable feedback for revision and loop.
- Human can always override or give additional guidance.

Quality examples:
- Developer provides high-quality “secret sauce” examples per specialist task.
- User may drop their own examples/documents into a designated folder (can be from other projects).
- Critic extracts and applies the quality standard; it must not copy content.

## Human-on-the-loop & Persistence

- Continuous loop.
- After significant steps or when input is needed, pause at checkpoints, show status, and save state.
- User can approve, reject, give new instructions, provide context, stop, or undo.
- On small steps, continue if the user does nothing.
- Persist after every meaningful turn: current specialist, discovery summary, artifacts, critic results, open questions, progress.
- State must survive across loops and sessions (file-based is fine for v1).

## Tools (v1 – extremely limited)

Native function calling via OpenRouter only. Scope tools per specialist allow-list:

- List directory / project structure (limited by specialist)
- Read file
- Write / create file
- Edit file (safe write)
- Read project state
- Update project state
- List quality examples
- Read quality example

No unrestricted shell or broad filesystem access in v1. Prefer narrow, safe, schema-validated tools.

## Test Bed (build in parallel)

Create `dev/` or `testbed/` that supports **autonomous end-to-end testing**, including live OpenRouter API calls:

- `test_prompts/` — realistic user requests
- Expected outputs or per-test grading criteria
- `grading_criteria.md` (or equivalent)
- Clear instructions for running the E2E suite

The runner must be able to:
- Execute a test prompt against the full agent
- Use real OpenRouter model API calls (not only mocks) to exercise the live system
- Capture outputs and intermediate steps
- Grade response quality against criteria (including critic behavior and overall output quality)
- Surface common bugs/failures and attempt (or propose) controlled fixes

Tests should validate the system as a whole, not only isolated units.

## Technical Preferences

- Language: TypeScript preferred (cleanest maintainable result for terminal agent + OpenRouter). Python acceptable if it yields a sharper MVP.
- Model access: OpenRouter only. User selects model from a list/dropdown.
- Config via environment variables + simple config file.
- Clean separation: core agent loop, specialist packages, tools, state, critic, terminal interface.
- Readable code that is easy to extend later.

## Out of Scope for v1

- Slack or any chat platform
- Local model serving (pi / llama.cpp)
- Web search
- Complex multi-agent swarms
- Rich GUI
- Auth / multi-user
- Automatic internet research

## Success Criteria for MVP

- User can start the app, select a model, point at a project folder, and request CONOPS, capabilities, milestones, or WBS.
- Agent classifies, loads specialist context, discovers existing state, drafts, runs critic against quality examples, and only presents high-quality results (or clear feedback).
- Loop-based with clear human checkpoints and persisted status.
- Autonomous test bed exists and exercises main flows with live OpenRouter calls and quality grading.

## Implementation Order

1. Project skeleton + OpenRouter integration + model selection
2. Basic agentic tool-use loop
3. Project state + simple discovery tools
4. Specialist package loading (start with 2–3 packages)
5. Critic stage with quality examples
6. Terminal interaction loop with human-on-the-loop
7. Test bed structure + first E2E tests (including live OpenRouter quality evaluation)
8. Polish, error handling, status visibility

Start simple. Make the MVP sharp and reliable. Do not add features outside the flow above.