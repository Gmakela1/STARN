import path from 'node:path';
import fs from 'node:fs';
import { OpenRouterClient } from '../openrouter/client.js';
import { ProjectStateManager } from '../workspace/state.js';
import { ToolRegistry } from '../tools/registry.js';
import { SpecialistRegistry } from '../specialists/registry.js';
import { runDiscovery } from './discovery.js';
import { classifyRequest } from './classifier.js';
import { runAgentToolLoop } from './agent-loop.js';
import { CriticEvaluator, CriticResult } from './critic.js';

export interface TurnOptions {
  userPrompt: string;
  projectPath: string;
  stateManager: ProjectStateManager;
  client: OpenRouterClient;
  model: string;
  toolRegistry: ToolRegistry;
  specialistRegistry: SpecialistRegistry;
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
      onStatusUpdate,
      onToolCall
    } = options;

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
    const agentResult = await runAgentToolLoop({
      client,
      model,
      systemPrompt: enhancedSystemPrompt,
      userMessage: userPrompt,
      toolRegistry,
      allowedTools: specialist.allowedTools,
      context,
      onToolCall
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

          const revisionPrompt = `The Critic evaluated your draft and found the following weaknesses:\n${criticResult.weaknesses.map(w => `- ${w}`).join('\n')}\n\nActionable Guidance:\n${criticResult.actionableGuidance}\n\nPlease revise the deliverable to resolve all weaknesses while maintaining rigorous physical engineering standards.`;

          const revisionResult = await runAgentToolLoop({
            client,
            model,
            systemPrompt: enhancedSystemPrompt,
            userMessage: revisionPrompt,
            toolRegistry,
            allowedTools: specialist.allowedTools,
            context,
            onToolCall
          });
          finalOutput = revisionResult.finalResponse;
        } else {
          break;
        }
      }
    }

    return {
      specialistId: specialist.id,
      specialistName: specialist.name,
      output: finalOutput,
      criticResult,
      autoRevisionsRun,
      requiresReview: specialist.requiresCritic
    };
  }
}
