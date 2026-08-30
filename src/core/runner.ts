import path from 'node:path';
import fs from 'node:fs';
import { OpenRouterClient } from '../openrouter/client.js';
import { ProjectStateManager } from '../workspace/state.js';
import { ToolRegistry } from '../tools/registry.js';
import { SpecialistRegistry } from '../specialists/registry.js';
import { ChatMessage } from '../openrouter/types.js';
import { runDiscovery } from './discovery.js';
import { classifyRequest } from './classifier.js';
import { runAgentToolLoop } from './agent-loop.js';
import { CriticEvaluator, CriticResult, BaselineDocument } from './critic.js';
import { formatWorkflowRoadmap } from '../cli/ui.js';

export interface TurnOptions {
  userPrompt: string;
  projectPath: string;
  stateManager: ProjectStateManager;
  client: OpenRouterClient;
  model: string;
  toolRegistry: ToolRegistry;
  specialistRegistry: SpecialistRegistry;
  sessionMessages?: ChatMessage[];
  onStatusUpdate?: (status: string) => void;
  onToolCall?: (tool: string, args: any) => void;
}

export interface TurnResult {
  specialistId: string;
  specialistName: string;
  output: string;
  criticResult?: CriticResult;
  autoRevisionsRun: number;
  requiresReview: boolean;
  sessionMessages: ChatMessage[];
}

export class CoreRunner {
  static async executeTurn(options: TurnOptions): Promise<TurnResult> {
    const {
      userPrompt,
      projectPath,
      stateManager,
      client,
      model,
      toolRegistry,
      specialistRegistry,
      sessionMessages = [],
      onStatusUpdate,
      onToolCall
    } = options;

    const state = stateManager.getState();
    const activeWorkflowPhase = state.workflow?.activePhase || 'conops';

    // 0. Handle quick commands (/plan, /roadmap, /status)
    const trimmed = userPrompt.trim().toLowerCase();
    if (trimmed === '/plan' || trimmed === '/roadmap' || trimmed === '/status') {
      const roadmapText = formatWorkflowRoadmap(state);
      return {
        specialistId: 'general',
        specialistName: 'Project Workflow Planner',
        output: roadmapText,
        autoRevisionsRun: 0,
        requiresReview: false,
        sessionMessages: [
          ...sessionMessages,
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: roadmapText }
        ]
      };
    }

    // 1. Classification (phase-aware with phase locking)
    onStatusUpdate?.('Classifying request...');
    let specialistId = await classifyRequest(userPrompt, client, model, activeWorkflowPhase);
    let specialist = specialistRegistry.get(specialistId) || specialistRegistry.get('general')!;

    // 2. Prerequisite Check Gate
    if (specialist.prerequisiteArtifactId) {
      const isMet = stateManager.isArtifactApproved(specialist.prerequisiteArtifactId);
      if (!isMet) {
        const prereqName = specialistRegistry.get(specialist.prerequisiteArtifactId.toLowerCase())?.name || specialist.prerequisiteArtifactId;
        const explanation = `Prerequisite Required: The ${prereqName} (${specialist.prerequisiteArtifactId}.md) deliverable has not yet been approved for this project.\n\nPlease complete and approve ${specialist.prerequisiteArtifactId}.md before proceeding to ${specialist.name}.`;
        
        return {
          specialistId: 'general',
          specialistName: 'General / Project Lead',
          output: explanation,
          autoRevisionsRun: 0,
          requiresReview: false,
          sessionMessages: [
            ...sessionMessages,
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: explanation }
          ]
        };
      }
    }

    // Update active phase if shifting to a formal specialist
    if (specialist.id !== 'general' && state.workflow?.phases[specialist.id]) {
      stateManager.setActivePhase(specialist.id);
    }

    // 3. Mandatory Discovery
    onStatusUpdate?.('Running mandatory project discovery...');
    const discovery = await runDiscovery(projectPath, stateManager);

    // 4. Adaptive Story-Based Intake Interview for CONOPS if not yet completed
    const hasApprovedConops = stateManager.isArtifactApproved('CONOPS');
    if (specialist.id === 'conops' && !hasApprovedConops && !state.intake.completed) {
      const intake = state.intake;
      const qIndex = intake.currentQuestionIndex;

      // Question 1: Project Identity (auto-capture if already provided)
      if (qIndex === 0 && !intake.answers.projectName) {
        stateManager.recordIntakeAnswer('projectName', userPrompt);
        stateManager.incrementIntakeQuestion();
        // Immediately advance to Question 2 (operational story)
        const msg = `Great! I've captured your project description: "${userPrompt}"\n\nNow, walk me through how you envision using this from start to finish. Paint the story of a typical operating session:\n- Where does it start?\n- What specific tasks or work will it perform?\n- What does the full use cycle look like?`;
        return {
          specialistId: 'conops',
          specialistName: 'CONOPS Intake',
          output: msg,
          autoRevisionsRun: 0,
          requiresReview: false,
          sessionMessages: [
            ...sessionMessages,
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: msg }
          ]
        };
      }

      // Question 2: Operational Story (recorded as question_1_answer)
      if (qIndex === 1 && !intake.answers.operationalStory) {
        stateManager.recordIntakeAnswer('operationalStory', userPrompt);
        stateManager.incrementIntakeQuestion();
        // Advance to dynamic questions via LLM
        const nextQ = await this.generateDynamicIntakeQuestion(client, model, userPrompt, 'operationalStory', 2);
        return nextQ;
      }

      // Dynamic Adaptive Questions 3, 4, 5 generated by LLM
      if (qIndex >= 2 && qIndex < 5) {
        const answerKey = `question_${qIndex}_answer`;
        stateManager.recordIntakeAnswer(answerKey, userPrompt);
        stateManager.incrementIntakeQuestion();

        if (qIndex >= 4) {
          // After question 4, record and synthesize
          stateManager.recordIntakeAnswer('finalIntakeNotes', userPrompt);
          stateManager.completeIntake();
        } else {
          const nextQ = await this.generateDynamicIntakeQuestion(client, model, userPrompt, answerKey, qIndex + 1);
          return nextQ;
        }
      } else {
        // At question 5+, record final answer and synthesize
        stateManager.recordIntakeAnswer('finalIntakeNotes', userPrompt);
        stateManager.completeIntake();
      }
    }

    // 5. Check if Target Artifact already exists to evolve
    let existingBaselineText = '';
    const targetDocPath = path.join(projectPath, 'docs', `${specialist.id.toUpperCase()}.md`);
    if (fs.existsSync(targetDocPath)) {
      try {
        const existingContent = fs.readFileSync(targetDocPath, 'utf-8');
        if (existingContent.trim()) {
          existingBaselineText = `\nEXISTING BASELINE DOCUMENT (TO EVOLVE / UPDATE):\nAn approved baseline for this deliverable already exists at docs/${specialist.id.toUpperCase()}.md:\n\`\`\`markdown\n${existingContent}\n\`\`\`\nINSTRUCTION: You must EVOLVE and UPDATE this existing baseline document to incorporate the user's requested additions or changes, rather than starting from scratch.\n\nSECTION 6 ANSWER HANDLING (if applicable):\nIf the existing document has a Section 6 (Open Questions) and the user is now answering those questions, EDIT the relevant sections IN PLACE to reflect the answer. Remove the answered question from Section 6. Do NOT regenerate or rewrite the entire document from scratch. Do NOT include your reasoning, thought process, or meta-commentary in the document output.\n`;
        }
      } catch (_e) {
        // ignore read error
      }
    }

    // 6. Specialist Execution Loop
    onStatusUpdate?.(`Executing specialist: ${specialist.name}...`);
    const enhancedSystemPrompt = `${specialist.systemPrompt}\n\n${discovery.discoveryText}${existingBaselineText}`;

    const context = { projectPath, stateManager };
    const agentResult = await runAgentToolLoop({
      client,
      model,
      systemPrompt: enhancedSystemPrompt,
      userMessage: userPrompt,
      toolRegistry,
      allowedTools: specialist.allowedTools,
      context,
      priorMessages: sessionMessages,
      onToolCall
    });

    let finalOutput = agentResult.finalResponse;
    let criticResult: CriticResult | undefined;
    let autoRevisionsRun = 0;

    // If the LLM wrote the file to disk but responded with commentary, recover the document for the critic
    let artifactForCritic = finalOutput;
    if (specialist.requiresCritic && !finalOutput.includes('# ')) {
      try {
        const filePath = path.join(projectPath, 'docs', `${specialist.id.toUpperCase()}.md`);
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf-8').trim();
          if (fileContent && fileContent.startsWith('# ')) {
            artifactForCritic = fileContent;
          }
        }
      } catch (_e) {
        // ignore
      }
    }

    // 7. Critic While-Loop with Program Baseline Verification
    if (specialist.requiresCritic) {
      onStatusUpdate?.('Running harsh critic evaluation with program alignment...');
      const critic = new CriticEvaluator(client);
      let attempts = 0;
      const maxAttempts = 2;
      let passed = false;

      // Load all existing approved baseline documents for cross-document program alignment
      const programBaselineDocs: BaselineDocument[] = [];
      const docsDir = path.join(projectPath, 'docs');
      if (fs.existsSync(docsDir)) {
        const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
        for (const f of files) {
          const docId = f.replace(/\.md$/i, '').toUpperCase();
          if (docId !== specialist.id.toUpperCase()) {
            try {
              const content = fs.readFileSync(path.join(docsDir, f), 'utf-8');
              if (content.trim()) {
                programBaselineDocs.push({
                  id: docId,
                  path: `docs/${f}`,
                  content
                });
              }
            } catch (_e) {
              // ignore
            }
          }
        }
      }

      while (attempts <= maxAttempts && !passed) {
        // Load user custom examples if present
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
          artifactContent: artifactForCritic,
          rubric: specialist.criticRubric || '',
          secretSauceExamples: specialist.secretSauceExamples,
          userExamples: customExamples,
          programBaselineDocuments: programBaselineDocs
        });

        if (criticResult.passed) {
          passed = true;
          break;
        }

        if (attempts < maxAttempts) {
          attempts++;
          autoRevisionsRun++;
          onStatusUpdate?.(`Critic requested improvements (Score: ${criticResult.score}/10). Revising draft (Attempt ${attempts}/${maxAttempts})...`);

          const revisionPrompt = `The Critic evaluated your draft and found the following weaknesses:\n${(criticResult.weaknesses || []).map(w => `- ${w}`).join('\n')}\n\nActionable Guidance:\n${criticResult.actionableGuidance || 'Fix weaknesses'}\n\nPlease revise the deliverable to resolve all weaknesses while maintaining rigorous physical engineering standards and program alignment.`;

          const revisionResult = await runAgentToolLoop({
            client,
            model,
            systemPrompt: enhancedSystemPrompt,
            userMessage: revisionPrompt,
            toolRegistry,
            allowedTools: specialist.allowedTools,
            context,
            priorMessages: sessionMessages,
            onToolCall
          });
          finalOutput = revisionResult.finalResponse;
          // Re-check the disk file after revision (LLM may have written a new draft)
          if (!finalOutput.includes('# ')) {
            try {
              const filePath = path.join(projectPath, 'docs', `${specialist.id.toUpperCase()}.md`);
              if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, 'utf-8').trim();
                if (fileContent && fileContent.startsWith('# ')) {
                  artifactForCritic = fileContent;
                }
              }
            } catch (_e) {
              // ignore
            }
          } else {
            artifactForCritic = finalOutput;
          }
        } else {
          break;
        }
      }
    }

    const updatedSessionMessages: ChatMessage[] = [
      ...sessionMessages,
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: finalOutput }
    ];

    return {
      specialistId: specialist.id,
      specialistName: specialist.name,
      output: finalOutput,
      criticResult,
      autoRevisionsRun,
      requiresReview: specialist.requiresCritic,
      sessionMessages: updatedSessionMessages
    };
  }

  // Helper: Generate dynamic adaptive intake question via LLM
  private static async generateDynamicIntakeQuestion(
    client: OpenRouterClient,
    model: string,
    userPrompt: string,
    answerKey: string,
    questionNumber: number
  ): Promise<TurnResult> {
    const intakePrompt = `You are the CONOPS Specialist conducting a story-based intake interview for a physical/hardware engineering project.
Review the user's project details gathered so far:
${JSON.stringify({ projectName: userPrompt, lastAnswerKey: answerKey, questionNumber }, null, 2)}

User's latest response: "${userPrompt}"

TASK:
Formulate the next single, highly relevant guided question tailored to this specific project.
Key topics to explore based on what is missing:
- Operating Location & Climate (indoor/outdoor, geographic climate extremes, terrain).
- Daily Operational Use Cases & Duty Cycle (routine tasks, required continuous runtime, duty cycle).
- Physical & Structural Boundaries (donor vehicle chassis, structure dimensions, mechanical interfaces).
- Charging, Storage & Critical Safety Protections.

Acknowledge their previous answer briefly and naturally, then ask the next question clearly.
The question should feel conversational and help the user paint a picture of how they will use this project.
Respond with ONLY the response text to the user.`;

    try {
      const intakeRes = await client.chatCompletion({
        model,
        messages: [{ role: 'user', content: intakePrompt }],
        temperature: 0.2
      });

      const nextQuestionText = intakeRes.content || `Thank you! Next question:\n\n${questionNumber}. Where will this project be operated (indoor/outdoor, climate conditions, terrain), and what are the primary use cases?`;

      return {
        specialistId: 'conops',
        specialistName: 'CONOPS Intake',
        output: nextQuestionText,
        autoRevisionsRun: 0,
        requiresReview: false,
        sessionMessages: []
      };
    } catch (_e) {
      return {
        specialistId: 'conops',
        specialistName: 'CONOPS Intake',
        output: `Thank you! Next guided question:\n\n${questionNumber}. Where will this project be operated (indoor/outdoor, climate conditions, terrain), and what are the primary use cases?`,
        autoRevisionsRun: 0,
        requiresReview: false,
        sessionMessages: []
      };
    }
  }
}
