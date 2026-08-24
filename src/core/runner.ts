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

    // 1. Classification (phase-aware)
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

    // 4. Special Intake Interview for CONOPS if not yet completed
    const hasApprovedConops = stateManager.isArtifactApproved('CONOPS');
    if (specialist.id === 'conops' && !hasApprovedConops && !state.intake.completed) {
      const intake = state.intake;
      const qIndex = intake.currentQuestionIndex;

      // First question
      if (qIndex === 0 && !intake.answers.projectName) {
        stateManager.incrementIntakeQuestion();
        const msg = `Welcome! Let's establish the foundation for this project before drafting the CONOPS.\n\n1. What is the project? (e.g. "Converting a 19HP diesel lawn tractor to an electric battery powertrain", or "Building a 120 sq ft solar shed")`;
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

      // Record answer and ask next question
      if (qIndex === 1 && !intake.answers.projectIntent) {
        stateManager.recordIntakeAnswer('projectName', userPrompt);
        stateManager.incrementIntakeQuestion();
        const msg = `Got it: "${userPrompt}".\n\n2. What is the primary intent and operational goal of this project? (What problem does it solve, and how will it be used?)`;
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

      if (qIndex === 2 && !intake.answers.domainSpecs) {
        stateManager.recordIntakeAnswer('projectIntent', userPrompt);
        stateManager.incrementIntakeQuestion();
        const msg = `Thank you. Next guided question:\n\n3. What are the key mechanical/physical boundaries or donor vehicle/structure parameters? (e.g., dimensions, chassis type, transmission interface, or mounting footprint)`;
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

      if (qIndex === 3 && !intake.answers.powerSpecs) {
        stateManager.recordIntakeAnswer('domainSpecs', userPrompt);
        stateManager.incrementIntakeQuestion();
        const msg = `Great. Next question:\n\n4. What are your electrical, power, or runtime targets? (e.g., target battery voltage [48V, 72V, 96V], capacity, motor power, or duty cycle duration)`;
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

      if (qIndex === 4 && !intake.answers.environmentalSafety) {
        stateManager.recordIntakeAnswer('powerSpecs', userPrompt);
        stateManager.incrementIntakeQuestion();
        const msg = `Understood. Final intake question:\n\n5. What environmental conditions and critical safety features are required? (e.g., operating temperature range, weatherproofing, emergency stop, operator presence switch)`;
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

      // If at question 5, record final answer and mark intake complete so we synthesize draft
      stateManager.recordIntakeAnswer('environmentalSafety', userPrompt);
      stateManager.completeIntake();
    }

    // 5. Check if Target Artifact already exists to evolve
    let existingBaselineText = '';
    const targetDocPath = path.join(projectPath, 'docs', `${specialist.id.toUpperCase()}.md`);
    if (fs.existsSync(targetDocPath)) {
      try {
        const existingContent = fs.readFileSync(targetDocPath, 'utf-8');
        if (existingContent.trim()) {
          existingBaselineText = `\nEXISTING BASELINE DOCUMENT (TO EVOLVE / UPDATE):\nAn approved baseline for this deliverable already exists at docs/${specialist.id.toUpperCase()}.md:\n\`\`\`markdown\n${existingContent}\n\`\`\`\nINSTRUCTION: You must EVOLVE and UPDATE this existing baseline document to incorporate the user's requested additions or changes, rather than starting from scratch.\n`;
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
          artifactContent: finalOutput,
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
}
