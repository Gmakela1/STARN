import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { CoreRunner } from '../src/core/runner.js';
import { TestPrompt, GradingCriteria, GradeResult, TestExecutionResult } from './types.js';
import { GRADING_RUBRICS } from './grading_criteria/rubrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class TestbedRunner {
  private client: OpenRouterClient;
  private toolRegistry: ToolRegistry;
  private specialistRegistry: SpecialistRegistry;

  constructor(client: OpenRouterClient) {
    this.client = client;
    this.toolRegistry = new ToolRegistry();
    this.specialistRegistry = new SpecialistRegistry();
  }

  public loadTestSuites(): TestPrompt[] {
    const promptsDir = path.join(__dirname, 'test_prompts');
    const files = fs.readdirSync(promptsDir).filter(f => f.endsWith('.json'));
    const suites: TestPrompt[] = [];

    for (const file of files) {
      const raw = fs.readFileSync(path.join(promptsDir, file), 'utf-8');
      suites.push(JSON.parse(raw) as TestPrompt);
    }

    return suites;
  }

  public gradeArtifact(artifactContent: string, criteria: GradingCriteria): GradeResult {
    const lowerContent = artifactContent.toLowerCase();
    const matchedHeadings: string[] = [];
    const missingHeadings: string[] = [];

    for (const heading of criteria.requiredHeadings) {
      if (lowerContent.includes(heading.toLowerCase())) {
        matchedHeadings.push(heading);
      } else {
        missingHeadings.push(heading);
      }
    }

    const matchedKeywords: string[] = [];
    const missingKeywords: string[] = [];

    for (const kw of criteria.requiredKeywords) {
      if (lowerContent.includes(kw.toLowerCase())) {
        matchedKeywords.push(kw);
      } else {
        missingKeywords.push(kw);
      }
    }

    const words = artifactContent.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    const headingScore = criteria.requiredHeadings.length > 0
      ? (matchedHeadings.length / criteria.requiredHeadings.length) * 5.0
      : 5.0;

    const keywordScore = criteria.requiredKeywords.length > 0
      ? (matchedKeywords.length / criteria.requiredKeywords.length) * 4.0
      : 4.0;

    const lengthScore = wordCount >= criteria.minWordCount ? 1.0 : Math.max(0, wordCount / criteria.minWordCount);
    const totalScore = Number((headingScore + keywordScore + lengthScore).toFixed(1));

    const passed = totalScore >= 7.5 && missingHeadings.length === 0;

    const feedback: string[] = [];
    if (missingHeadings.length > 0) {
      feedback.push(`Missing required headings: ${missingHeadings.join(', ')}`);
    }
    if (missingKeywords.length > 0) {
      feedback.push(`Missing technical keywords: ${missingKeywords.join(', ')}`);
    }
    if (wordCount < criteria.minWordCount) {
      feedback.push(`Word count ${wordCount} is below minimum threshold ${criteria.minWordCount}`);
    }

    return {
      passed,
      score: totalScore,
      matchedHeadings,
      missingHeadings,
      matchedKeywords,
      missingKeywords,
      wordCount,
      feedback
    };
  }

  public async runScenario(test: TestPrompt, model: string = 'anthropic/claude-3.5-sonnet'): Promise<TestExecutionResult> {
    const tempDir = path.join(os.tmpdir(), `starn-e2e-${test.id}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      if (test.projectContextFiles) {
        for (const [relPath, content] of Object.entries(test.projectContextFiles)) {
          const abs = path.join(tempDir, relPath);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, content, 'utf-8');
        }
      }

      const stateMgr = new ProjectStateManager(tempDir);
      stateMgr.getOrCreateState(test.id, test.name);

      const result = await CoreRunner.executeTurn({
        userPrompt: test.userPrompt,
        projectPath: tempDir,
        stateManager: stateMgr,
        client: this.client,
        model,
        toolRegistry: this.toolRegistry,
        specialistRegistry: this.specialistRegistry
      });

      const criteria = GRADING_RUBRICS[test.id] || {
        requiredHeadings: [],
        requiredKeywords: [],
        minWordCount: 50
      };

      const grade = this.gradeArtifact(result.output, criteria);

      const specialistMatched = result.specialistId === test.expectedSpecialist;
      const overallPassed = grade.passed && specialistMatched;

      return {
        testId: test.id,
        testName: test.name,
        passed: overallPassed,
        specialistRouted: result.specialistId,
        expectedSpecialist: test.expectedSpecialist,
        grade,
        autoRevisionsRun: result.autoRevisionsRun
      };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
