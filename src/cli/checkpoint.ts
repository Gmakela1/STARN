import { select, input, checkbox } from '@inquirer/prompts';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import boxen from 'boxen';
import { CriticResult, enrichFeedbackWithCritic } from '../core/critic.js';
import { approveArtifact, parseAffectedPhaseIds } from '../core/approvals.js';
import { harvestDecisionLog } from '../core/decision-log.js';

// Re-exported for backward compatibility (now lives headlessly in core/critic.ts)
export { enrichFeedbackWithCritic };
// Re-exported for backward compatibility (moved verbatim to core/decision-log.ts)
export { harvestDecisionLog };
import { ProjectStateManager } from '../workspace/state.js';
import { OpenRouterClient } from '../openrouter/client.js';
import { ChatClient } from '../openrouter/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { formatCriticFindingsTable, formatCriticScorecard, extractCleanMarkdownDocument, formatDocumentPreview, formatDocumentToc, extractSections } from './ui.js';
import { promptInputWithVoice } from './prompts.js';

export interface CheckpointReviewOptions {
  specialistId: string;
  specialistName: string;
  output: string;
  criticResult?: CriticResult;
  projectPath: string;
  stateManager: ProjectStateManager;
  /** Drafting client/model (change-impact analysis). */
  client?: ChatClient;
  model?: string;
  /** OpenRouter client for voice transcription. */
  voiceClient?: OpenRouterClient;
  /** Speech-to-text model for voice transcription. */
  voiceModel?: string;
  toolRegistry?: ToolRegistry;
}

export type CheckpointAction = 'accept' | 'feedback' | 'override' | 'discard' | 'browse_sections' | 'view_full_paged';

export async function runHumanCheckpoint(
  options: CheckpointReviewOptions
): Promise<{ action: CheckpointAction; feedback?: string }> {
  const { specialistId, specialistName, output, criticResult, projectPath, stateManager, client, model, toolRegistry } = options;

  // Always prefer the disk file as the authoritative deliverable — it is what the LLM
  // actually wrote via the fs_write tool. The text response (output) may be commentary
  // or an older version of the doc that pre-dates any post-write LLM edits.
  let isFullDeliverable = false;
  let cleanedDoc = output;

  if (specialistId !== 'general') {
    const docName = `${specialistId.toUpperCase()}.md`;
    const filePath = path.join(projectPath, 'docs', docName);
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8').trim();
        if (fileContent && fileContent.startsWith('# ')) {
          cleanedDoc = fileContent;
          isFullDeliverable = true;
        }
      } catch (_e) {
        // fall through to output-based extraction
      }
    }
    // Fallback: no disk file yet — extract from output if it looks like a document
    if (!isFullDeliverable && output.includes('# ')) {
      cleanedDoc = extractCleanMarkdownDocument(output);
      isFullDeliverable = true;
    }
  }

  // Panel 1 — Critic scorecard (always shown when a critic ran)
  if (criticResult) {
    console.log(formatCriticScorecard(criticResult));
  } else {
    console.log(chalk.dim('\n(No critic evaluation for this deliverable.)\n'));
  }

  // Panel 2 — Document TOC (for deliverables)
  if (isFullDeliverable) {
    const lines = cleanedDoc.split('\n');
    const wordCount = cleanedDoc.trim().split(/\s+/).filter(Boolean).length;
    let tocBox = `${chalk.bold.cyan(`${specialistName} (${specialistId.toUpperCase()}.md)`)}\n`;
    tocBox += `${chalk.dim(`Length: ${lines.length} lines (~${wordCount} words)`)}\n\n`;
    tocBox += `${chalk.bold('Table of Contents:')}\n`;
    tocBox += formatDocumentToc(cleanedDoc);
    console.log(boxen(tocBox, {
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'cyan',
      title: 'Deliverable',
      titleAlignment: 'left'
    }));
  } else {
    console.log(`\n${output}\n`);
  }

  let promptActive = true;
  let finalAction: CheckpointAction = 'accept';
  let userFeedback: string | undefined;

  while (promptActive) {
    const choices: Array<{ name: string; value: CheckpointAction }> = [];

    if (isFullDeliverable) {
      choices.push({ name: '👁  Browse sections (view a whole section)', value: 'browse_sections' });
      choices.push({ name: '📄 View full document (paged)', value: 'view_full_paged' });
    }

    if (criticResult?.passed) {
      choices.push({ name: '✔  Accept deliverable & save to project docs', value: 'accept' });
      choices.push({ name: '✎  Provide feedback and request revisions', value: 'feedback' });
      choices.push({ name: '✖  Discard / cancel', value: 'discard' });
    } else if (criticResult && !criticResult.passed) {
      choices.push({ name: '✎  Provide guidance and let agent re-try', value: 'feedback' });
      choices.push({ name: '⚡ Override Critic & force accept deliverable', value: 'override' });
      choices.push({ name: '✖  Discard / cancel', value: 'discard' });
    } else {
      // Non-critic / conversational / intake questions
      choices.push({ name: '✔  Proceed / Continue', value: 'accept' });
      choices.push({ name: '✎  Reply / Provide Answer', value: 'feedback' });
    }

    const action = await select({
      message: isFullDeliverable ? 'Deliverable Ready — choose action:' : 'Review Checkpoint:',
      choices
    });

    if (action === 'browse_sections') {
      const sections = extractSections(cleanedDoc);
      const sectionNames = Object.keys(sections);
      if (sectionNames.length === 0) {
        console.log(chalk.yellow('No sections found in this document.\n'));
        continue;
      }
      const selected = await select({
        message: 'Select a section to view (shows the whole section):',
        choices: sectionNames.map(name => ({ name, value: name }))
      });
      console.log(`\n${chalk.bold.underline(selected)}\n`);
      console.log(sections[selected]);
      console.log(`\n${chalk.dim('─'.repeat(60))}\n`);
      continue; // loop back to menu
    }

    if (action === 'view_full_paged') {
      const lines = cleanedDoc.split('\n');
      const pageSize = Math.max(20, process.stdout.rows ? process.stdout.rows - 5 : 40);
      let offset = 0;
      while (offset < lines.length) {
        const slice = lines.slice(offset, offset + pageSize);
        console.log(slice.join('\n'));
        offset += pageSize;
        if (offset < lines.length) {
          const next = await select({
            message: `Lines ${offset}/${lines.length}:`,
            choices: [
              { name: '▶ Next page', value: 'next' },
              { name: '⏭ Skip to end', value: 'skip' },
              { name: '↩ Back to menu', value: 'back' }
            ]
          });
          if (next === 'skip') offset = lines.length;
          if (next === 'back') break;
        }
      }
      continue; // loop back to menu
    }

    if (action === 'feedback') {
      const feedback = await promptInputWithVoice(
        'Enter your response / feedback for the agent:',
        options.voiceClient,
        options.voiceModel
      );
      userFeedback = enrichFeedbackWithCritic(feedback, criticResult);
      finalAction = 'feedback';
      promptActive = false;
      break;
    }

    if (action === 'accept' || action === 'override') {
      if (isFullDeliverable) {
        const docName = `${specialistId.toUpperCase()}.md`;
        const outPath = path.join(path.join(projectPath, 'docs'), docName);

        // Core approval mechanics: write the doc, record the artifact (hash stored),
        // harvest design decisions, and auto-run change-impact on content change.
        // The CLI's caller (src/index.ts) advances to the next phase after accept, so
        // the core phase advance is disabled here to avoid double-advancing.
        let impactReport: string | undefined;
        const result = await approveArtifact({
          projectPath,
          stateManager,
          specialistId,
          content: cleanedDoc,
          title: `${specialistName} Document`,
          criticScore: criticResult?.score,
          advance: false,
          runChangeImpact: client && model && toolRegistry
            ? async phaseId => {
                // Preserve historical CLI behavior: only re-approvals with content
                // changes trigger change-impact (first approvals skip it).
                if (!stateManager.isArtifactApproved(phaseId.toUpperCase())) {
                  return [];
                }
                console.log(chalk.cyan('\n📋 Content changed since last approval — running change-impact analysis...'));
                try {
                  const { runAgentToolLoop } = await import('../core/agent-loop.js');
                  const { changeImpactPackage } = await import('../specialists/packages/change-impact/index.js');
                  const impactResult = await runAgentToolLoop({
                    client,
                    model,
                    systemPrompt: changeImpactPackage.systemPrompt,
                    userMessage: `Analyze the impact of changes to ${phaseId}. Compare the current docs/${phaseId}.md against all other approved/draft documents in docs/. Identify which downstream documents are now inconsistent and what specific sections/interfaces/requirements are affected.`,
                    toolRegistry,
                    allowedTools: changeImpactPackage.allowedTools,
                    context: { projectPath, stateManager }
                  });
                  console.log(`\n${chalk.bold.yellow('Change Impact Report:')}\n${impactResult.finalResponse}\n`);
                  impactReport = impactResult.finalResponse;
                  return parseAffectedPhaseIds(impactResult.finalResponse);
                } catch (err: any) {
                  console.log(chalk.yellow(`Change-impact analysis failed: ${err.message}`));
                  return [];
                }
              }
            : undefined
        });

        if (result.decisionCount > 0) {
          console.log(chalk.cyan(`\n📝 ${result.decisionCount} design decision(s) logged to docs/DECISIONS.md`));
        }
        console.log(chalk.green(`\n✔ Saved clean deliverable to ${outPath}`));

        // Downstream-align offer stays in the CLI — only core approval mechanics moved.
        if (result.changedSinceApproval && impactReport) {
          const align = await select({
            message: 'Apply these changes to downstream docs?',
            choices: [
              { name: '✎ Yes — align downstream docs now', value: 'align' },
              { name: '⏭  No — I\'ll handle it manually', value: 'skip' }
            ]
          });
          if (align === 'align') {
            userFeedback = `${impactReport}\n\nUSER INSTRUCTION: Apply the recommended changes above to align the downstream documents. Update the affected docs in place.`;
            finalAction = 'feedback';
            promptActive = false;
            break;
          }
        }
      }
      finalAction = action;
      promptActive = false;
      break;
    }

    finalAction = action;
    promptActive = false;
  }

  return { action: finalAction, feedback: userFeedback };
}

/**
 * Handles the case where the critic has exhausted auto-revisions (all attempts used, still failing).
 * Shows structured findings and lets the user intervene with per-item actions.
 */
export async function handleCriticFailure(
  criticResult: CriticResult,
  specialistName: string,
  client?: OpenRouterClient,
  voiceModel?: string
): Promise<{ action: 'feedback' | 'override' | 'discard'; feedback?: string; dismissedIndices?: number[] }> {
  console.log(formatCriticFindingsTable(criticResult));

  const allItems = criticResult.weaknesses || [];

  const choice = await select({
    message: `The ${specialistName} specialist couldn't resolve all critic findings after auto-revision. Choose action:`, 
    choices: [
      { name: '✎  Provide targeted feedback for specific issues', value: 'feedback' },
      ...(allItems.length > 0
        ? [{ name: '☑  Mark certain issues as acceptable, re-try on rest', value: 'dismiss' }]
        : []),
      { name: '⚡ Override — accept as-is despite critic', value: 'override' },
      { name: '✖  Discard / cancel', value: 'discard' }
    ]
  });

  if (choice === 'override') {
    return { action: 'override' };
  }

  if (choice === 'discard') {
    return { action: 'discard' };
  }

  if (choice === 'dismiss' && allItems.length > 0) {
    const selected = await checkbox({
      message: 'Which issues are acceptable as-is? (unselected items will be sent back for revision):',
      choices: allItems.map((item, i) => ({
        name: item,
        value: i,
        checked: false
      }))
    });

    const dismissedIndices = selected || [];
    const remainingIndices = allItems
      .map((_, i) => i)
      .filter(i => !dismissedIndices.includes(i));

    if (remainingIndices.length === 0) {
      // User dismissed all issues — treat as override
      return { action: 'override' };
    }

    const remainingItems = remainingIndices.map(i => allItems[i]);
    const feedback = `Resolve the remaining critic findings:\n${remainingItems.map((w, i) => `  ${i + 1}. [MAJOR] ${w}`).join('\n')}`;

    return { action: 'feedback', feedback, dismissedIndices };
  }

  // Full feedback
  const feedback = await promptInputWithVoice(
    'Enter your specific guidance for the specialist:',
    client,
    voiceModel
  );
  return { action: 'feedback', feedback };
}
