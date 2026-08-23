# STARN

> **Terminal-Based AI Project Management Assistant for Physical & Hardware Engineering**

STARN brings process discipline, modular engineering context packs, mandatory discovery, harsh critic gating, and human checkpoints to physical and hardware projects (such as off-grid solar sheds, outdoor structures, deployable systems, and robotics hardware).

---

## Key Features

1. **Specialist Context Packs (Strictly Gated Tools)**
   - **`general`**: Systems coordinator for Q&A, scoping, and project status navigation (read-only tools).
   - **`conops`**: Concept of Operations, physical environment specifications, and user intent.
   - **`capabilities`**: Numbered functional capabilities, structural/electrical specs, and verification matrices.
   - **`milestones`**: Phased development gates (MVP, IOC, FOC) with objective acceptance criteria.
   - **`wbs`**: Hierarchical Work Breakdown Structure with materials, dimensions, and commissioning steps.
   - **`sow`**: Contractor Statements of Work, scope agreements, and payment milestones.

2. **Mandatory Project Discovery**
   - Automatically scans project folders, existing markdown files, and prior state before any specialist action.

3. **Harsh Critic Gate & Auto-Revision While-Loop**
   - Evaluates drafted deliverables against developer "secret sauce" exemplars and user custom examples.
   - Runs an automated while-loop revision cycle (up to 2 attempts) to resolve weaknesses before presenting to the human reviewer.

4. **Human-on-the-Loop Checkpoints**
   - Displays clear scorecards (strengths, weaknesses, scores) with options to **Accept**, **Provide Feedback**, or **Override**.

5. **Multi-Project Workspace & State Persistence**
   - Central registry (`~/.starn/registry.json`) manages linked projects across your machine.
   - Per-project state (`<project>/.starn/state.json`) preserves artifacts, discovery summaries, and risks across sessions.

6. **Autonomous Testbed**
   - End-to-end evaluation harness under `testbed/` with test scenarios and automated grading rubrics.

---

## Installation & Setup

### 1. Prerequisites
- Node.js 20+
- An [OpenRouter API Key](https://openrouter.ai/)

### 2. Install Dependencies & Build
```bash
# Clone or navigate to the repository
cd STARN

# Install dependencies
npm install

# Build TypeScript
npm run build
```

### 3. Configure Environment
Create a `.env` file in the project root:
```bash
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
```

---

## Running STARN

### Launch Interactive CLI
```bash
npm start
# or during development:
npm run dev
```

### Flow Walkthrough
1. **Model Selection:** Choose from recommended OpenRouter models (e.g. Claude 3.5 Sonnet, GPT-4o, DeepSeek V3).
2. **Project Selection:** Pick an existing project or link a new project directory on your filesystem.
3. **Ask a Goal:** Enter your prompt (e.g., *"Create a WBS for building an off-grid solar trailer"*).
4. **Autonomous Execution:**
   - Classification routes the prompt to the proper specialist.
   - Discovery scans workspace files and updates project context.
   - Specialist tools execute safe operations inside the project directory.
   - Harsh Critic grades the draft and automatically requests revisions if quality thresholds are not met.
5. **Human Checkpoint:** Review the draft and critic scorecard. Accept to persist to `docs/<ARTIFACT>.md` or give iterative guidance.

---

## Quality Examples ("Secret Sauce" & Custom)

- **Developer "Secret Sauce":** Embedded directly within each specialist package in `src/specialists/packages/`.
- **User Custom Examples:** Place any markdown files under `<your-project>/examples/<specialist_id>/` (e.g., `<project>/examples/wbs/past_shed_wbs.md`). The Critic and agent will automatically load and apply them.

---

## Running Tests & Testbed

```bash
# Run unit and integration tests
npm test

# Run testbed scenario inspector
npm run testbed
```

---

## Architecture

```
STARN/
├── src/
│   ├── index.ts                      # CLI Entry point & startup wizard
│   ├── config.ts                     # Environment & user settings loader (~/.starn/config.json)
│   ├── core/
│   │   ├── runner.ts                 # Main request pipeline (orchestrator)
│   │   ├── agent-loop.ts             # Generic tool-use loop
│   │   ├── critic.ts                 # Harsh critic evaluator & auto-revision while loop
│   │   ├── classifier.ts             # Routes prompt to specialist package
│   │   └── discovery.ts              # Reads existing project files/state
│   ├── openrouter/
│   │   ├── client.ts                 # OpenRouter API client (OpenAI-compatible)
│   │   └── models.ts                 # Model catalog & presets
│   ├── workspace/
│   │   ├── registry.ts               # Manages linked projects in ~/.starn/registry.json
│   │   └── state.ts                  # Persisted project state manager
│   ├── specialists/
│   │   ├── types.ts                  # Specialist interfaces
│   │   ├── registry.ts               # Registry of specialist packages
│   │   └── packages/                 # general, conops, capabilities, milestones, wbs, sow
│   ├── tools/
│   │   ├── types.ts                  # Tool interfaces & schemas
│   │   ├── registry.ts               # Tool registration & per-specialist gating
│   │   └── handlers/                 # fs_read, fs_write, fs_list, state_read, state_update, example_reader
│   └── cli/
│       ├── ui.ts                     # Terminal formatting, banners, critic scorecards
│       ├── prompts.ts                # Inquirer prompts
│       └── checkpoint.ts             # Interactive human review checkpoints
└── testbed/                          # Autonomous E2E test runner
    ├── runner.ts                     # Scenario execution & grading harness
    ├── test_prompts/                 # Scenario fixtures
    └── grading_criteria/             # Heading, keyword & structural rubrics
```

---

## License
MIT
