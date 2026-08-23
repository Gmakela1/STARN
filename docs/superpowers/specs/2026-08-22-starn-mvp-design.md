# STARN MVP Design Specification

## 1. Overview & Vision
**STARN** is a terminal-based AI project management assistant focused on physical and hardware engineering projects (e.g., outdoor structures, solar power systems, deployable shelters, robotics/maker hardware, workshops). 

It enforces rigorous engineering discipline through:
1. **Mandatory Project Discovery** before any meaningful work.
2. **Context-Specific Specialist Packages** with strictly gated tool sets.
3. **Harsh Critic Gate** comparing deliverables against developer "secret sauce" and user quality examples with automated while-loop revisions.
4. **Human-on-the-Loop Checkpoints** for oversight and steering.
5. **Persisted State & Centralized Project Registry** enabling seamless multi-project tracking across sessions.

---

## 2. System Architecture

```
                               ┌────────────────────────┐
                               │   CLI / Startup Wizard  │
                               │ (Model & Project Pick) │
                               └───────────┬────────────┘
                                           │
                                           ▼
                               ┌────────────────────────┐
                               │       User Prompt      │
                               └───────────┬────────────┘
                                           │
                                           ▼
                               ┌────────────────────────┐
                               │   Request Classifier   │
                               │ (Routes to Specialist) │
                               └───────────┬────────────┘
                                           │
                                           ▼
                               ┌────────────────────────┐
                               │  Mandatory Discovery   │
                               │ (Scans Files & State)  │
                               └───────────┬────────────┘
                                           │
                                           ▼
                               ┌────────────────────────┐
                               │  Specialist Tool Loop  │◄─────────────┐
                               │ (Gated Function Calls) │              │
                               └───────────┬────────────┘              │
                                           │                           │
                            Deliverable    ▼                           │ Auto-Revision
                            Produced? ────────────┐                    │ (if failed,
                                           │      │                    │  max 2 attempts)
                                           │      ▼                    │
                                           │  ┌───────────────────────┐│
                                           │  │   Critic While-Loop   ││
                                           │  │ (Secret Sauce vs Draft││
                                           │  │  + User Examples)     ├┘
                                           │  └───────────┬───────────┘
                                           │              │
                                           ▼              ▼
                               ┌────────────────────────────────┐
                               │    Human Review Checkpoint     │
                               │   (Accept / Edit / Override)   │
                               └───────────────┬────────────────┘
                                               │
                                               ▼
                               ┌────────────────────────────────┐
                               │    Persist State & Artifacts   │
                               │  (<project>/.starn/state.json) │
                               └────────────────────────────────┘
```

---

## 3. Directory & File Structure

```
STARN/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts                      # CLI Entry point & startup wizard
│   ├── config.ts                     # Environment & user settings loader (~/.starn/config.json)
│   ├── core/
│   │   ├── runner.ts                 # Main request pipeline (linear orchestrator)
│   │   ├── agent-loop.ts             # Generic tool-use loop (OpenAI function calling style)
│   │   ├── critic.ts                 # Critic evaluator & auto-revision while loop
│   │   ├── classifier.ts             # Routes prompt to specialist package
│   │   └── discovery.ts              # Reads existing project files/state & prepares discovery context
│   ├── openrouter/
│   │   ├── client.ts                 # OpenRouter API wrapper (streaming, tool calls, headers)
│   │   └── models.ts                 # Model catalog / listing / validation
│   ├── workspace/
│   │   ├── registry.ts               # Manages linked projects in ~/.starn/registry.json
│   │   └── state.ts                  # Persisted project state manager
│   ├── specialists/
│   │   ├── types.ts                  # Specialist definition interfaces
│   │   ├── registry.ts               # Registry of specialist packages
│   │   └── packages/
│   │       ├── general/              # General / Project Lead package (no critic, Q&A, scoping)
│   │       ├── conops/               # CONOPS / User Intent
│   │       ├── capabilities/         # Product Capabilities & Requirements
│   │       ├── milestones/           # Milestones & Gating Criteria
│   │       └── wbs/                  # Work Breakdown Structure
│   │           ├── index.ts          # Instructions, tool allow-list, critic rubric
│   │           └── examples/         # Built-in "secret sauce" markdown quality examples
│   ├── tools/
│   │   ├── types.ts                  # Tool definitions & schemas (Zod + JSON Schema)
│   │   ├── registry.ts               # Tool registration & per-specialist gating
│   │   └── handlers/                 # Safe filesystem & state tools
│   │       ├── fs-read.ts
│   │       ├── fs-write.ts
│   │       ├── fs-list.ts
│   │       ├── state-read.ts
│   │       ├── state-update.ts
│   │       └── example-reader.ts     # Reads built-in and user custom examples
│   └── cli/
│       ├── ui.ts                     # Terminal formatting, spinners, banners, colors
│       ├── prompts.ts                # Inquirer prompts (model picker, project picker, checkpoints)
│       └── checkpoint.ts             # Interactive human checkpoint handler
└── testbed/                          # Autonomous E2E test runner
    ├── runner.ts                     # Test execution & grading harness
    ├── test_prompts/                 # Realistic user requests
    └── grading_criteria/             # Expected criteria and rubrics
```

---

## 4. Specialist Packages

Each specialist package is a self-contained module exposing:
- **`id`**: Unique identifier (e.g. `general`, `conops`, `capabilities`, `milestones`, `wbs`).
- **`name` & `description`**: User-facing labels.
- **`systemPrompt`**: Role instructions emphasizing physical engineering standards, real-world constraints (loads, tolerances, environmental factors, power requirements), and crisp technical formatting.
- **`allowedTools`**: Array of tool names accessible to this package.
- **`requiresCritic`**: `boolean` (`false` for `general`, `true` for document specialists).
- **`criticRubric`**: Evaluation criteria used by the critic.
- **`secretSauceExamples`**: Exemplar documents showcasing standard of rigor, structure, and depth.

### Specialist Matrix

| Package ID | Purpose | Allowed Tools | Critic Enabled |
| :--- | :--- | :--- | :--- |
| `general` | Project lead, Q&A, navigation, status updates, scoping conversations | `fs_read`, `fs_list`, `state_read`, `example_reader` | No |
| `conops` | Concept of Operations, physical operating environment, user intent | `fs_read`, `fs_write`, `fs_list`, `state_read`, `state_update`, `example_reader` | Yes |
| `capabilities` | System specifications, power/load/dimensional capabilities & requirements | `fs_read`, `fs_write`, `fs_list`, `state_read`, `state_update`, `example_reader` | Yes |
| `milestones` | Phased development gates (MVP, IOC, FOC) & acceptance criteria | `fs_read`, `fs_write`, `fs_list`, `state_read`, `state_update`, `example_reader` | Yes |
| `wbs` | Hierarchical Work Breakdown Structure, deliverables, work packages | `fs_read`, `fs_write`, `fs_list`, `state_read`, `state_update`, `example_reader` | Yes |

---

## 5. Execution Pipeline Details

### 1. Classification
- Input: User's message + recent context.
- Output: Matching specialist `packageId`.
- Fallback: If ambiguous or conversational, defaults to `general`.

### 2. Mandatory Discovery
- Runs automatically before specialist execution.
- Reads `<project>/.starn/state.json`, lists project files in `<project>/docs/` and `<project>/`, and extracts existing requirements and decisions.
- Generates a concise discovery summary prepended to the specialist's context.

### 3. Specialist Tool Loop
- Executes an OpenAI-compatible function-calling loop with OpenRouter.
- Tools are filtered strictly by `specialist.allowedTools`.
- Loop continues until the model issues a final response or requests user clarification.

### 4. Critic While-Loop
- If `specialist.requiresCritic === true` and an artifact was generated:
```typescript
let attempts = 0;
const maxAttempts = 2;
let passed = false;
let criticFeedback: CriticResult | null = null;

while (attempts <= maxAttempts && !passed) {
  criticFeedback = await critic.evaluate({
    artifactContent,
    rubric: specialist.criticRubric,
    secretSauceExamples: specialist.secretSauceExamples,
    userExamples: await loadUserExamples(projectPath, specialist.id)
  });

  if (criticFeedback.passed) {
    passed = true;
    break;
  }

  if (attempts < maxAttempts) {
    // Auto-revise with specialist
    artifactContent = await runner.reviseArtifact({
      specialist,
      originalDraft: artifactContent,
      feedback: criticFeedback
    });
  }
  attempts++;
}
```

### 5. Human Checkpoint
- Displays the final draft and the Critic's scorecard (scores, strengths, weaknesses).
- Prompts the user:
  1. `[Accept & Save]` $\to$ Saves document to `<project>/docs/<Artifact>.md`, updates state.
  2. `[Provide Feedback / Revise]` $\to$ Loops back to specialist with user feedback.
  3. `[Override & Accept]` $\to$ Forces acceptance even if Critic flagged warnings.
  4. `[Cancel / Discard]` $\to$ Aborts without saving changes.

---

## 6. Workspace & State Persistence

### Central Registry (`~/.starn/registry.json`)
```json
{
  "activeProjectId": "proj_shed_01",
  "defaultModel": "anthropic/claude-3.5-sonnet",
  "projects": [
    {
      "id": "proj_shed_01",
      "name": "Solar Generator Shed",
      "path": "/path/to/shed-project",
      "createdAt": "2026-08-22T19:00:00Z",
      "lastActiveAt": "2026-08-22T19:30:00Z"
    }
  ]
}
```

### Project State (`<project_path>/.starn/state.json`)
```json
{
  "projectId": "proj_shed_01",
  "name": "Solar Generator Shed",
  "currentPhase": "CONOPS",
  "discovery": {
    "lastScanned": "2026-08-22T19:15:00Z",
    "summary": "120 sq ft timber frame shed with 3kW roof solar array.",
    "keyConstraints": ["Under 120 sq ft", "Budget under $8,000"]
  },
  "artifacts": [
    {
      "id": "CONOPS",
      "title": "Concept of Operations",
      "path": "docs/CONOPS.md",
      "status": "approved",
      "criticScore": 9.2,
      "updatedAt": "2026-08-22T19:25:00Z"
    }
  ],
  "openRisks": [
    "Roof snow load with mounted solar panels"
  ],
  "recentActions": [
    "Generated CONOPS.md and passed critic"
  ]
}
```

---

## 7. Autonomous Testbed

Located under `testbed/`:
- `test_prompts/`: Standard physical project scenarios (e.g., `01_shed_conops.json`, `02_wbs_solar_trailer.json`).
- `grading_criteria/`: Expected artifact sections, domain rigor checks, and keyword validations.
- `runner.ts`:
  - Runs headless execution of STARN against OpenRouter or mocked fixtures.
  - Verifies tool gating, discovery summaries, critic evaluation scores, and state persistence.
  - Emits test reports with actionable error traces.

---

## 8. Success Criteria for v1 MVP

1. User launches CLI, selects an OpenRouter model, and creates or selects a linked project.
2. User submits a request (e.g., *"Create a WBS for building an off-grid solar trailer"*).
3. System routes to WBS specialist, performs discovery on the project folder, generates the WBS, and executes the Critic evaluation.
4. If Critic fails, the agent automatically revises up to 2 times.
5. User reviews the draft at the human checkpoint, accepts it, and confirms it is written to disk with updated `.starn/state.json`.
6. Autonomous testbed runs end-to-end tests cleanly.
