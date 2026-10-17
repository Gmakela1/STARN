import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import boxen from 'boxen';
import { select, confirm } from '@inquirer/prompts';
import {
  saveExample,
  saveReference,
  listLibrary,
  removeLibraryFile,
  LibraryListing
} from '../workspace/project-files.js';

export function parseFilePathArg(arg: string): string {
  const trimmed = arg.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatLibraryTable(listing: LibraryListing): string {
  let out = `${chalk.bold.cyan('PROJECT LIBRARY: REFERENCES & QUALITY EXAMPLES')}\n\n`;

  const hasRefs = listing.references.length > 0;
  const specKeys = Object.keys(listing.examples);
  const hasExamples = specKeys.length > 0;

  if (!hasRefs && !hasExamples) {
    out += chalk.dim('No reference documents or custom quality examples found in this project.\n');
    out += chalk.dim('Use /example <file> or /reference <file> to add files.');
    return boxen(out, { padding: 1, borderStyle: 'round', borderColor: 'cyan' });
  }

  // Reference Documents section
  out += `${chalk.bold.white('▶ REFERENCE DOCUMENTS (reference/)')}\n`;
  if (hasRefs) {
    for (const ref of listing.references) {
      out += `  • ${chalk.green(ref.name.padEnd(30))} ${chalk.dim(formatBytes(ref.size).padStart(10))}  ${chalk.dim(ref.modified.slice(0, 10))}\n`;
    }
  } else {
    out += `  ${chalk.dim('No reference documents yet.')}\n`;
  }
  out += '\n';

  // Specialist Quality Examples section
  out += `${chalk.bold.white('▶ CUSTOM QUALITY EXAMPLES (examples/<specialist>/)')}\n`;
  if (hasExamples) {
    for (const spec of specKeys) {
      out += `  ${chalk.bold.yellow(`[${spec.toUpperCase()}]`)}\n`;
      for (const ex of listing.examples[spec]) {
        out += `    • ${chalk.white(ex.name.padEnd(28))} ${chalk.dim(formatBytes(ex.size).padStart(10))}  ${chalk.dim(ex.modified.slice(0, 10))}\n`;
      }
    }
  } else {
    out += `  ${chalk.dim('No custom quality examples yet.')}\n`;
  }

  return boxen(out.trimEnd(), { padding: 1, borderStyle: 'round', borderColor: 'cyan' });
}

export async function handleExampleCommand(
  projectPath: string,
  activePhase: string,
  rawArg: string
): Promise<void> {
  const filePath = parseFilePathArg(rawArg);
  if (!filePath) {
    console.log(chalk.yellow('\n⚠ Please provide a file path: /example <path-to-file>\n'));
    return;
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    console.log(chalk.red(`\n✖ File not found: ${resolved}\n`));
    return;
  }

  const filename = path.basename(resolved);
  const buffer = fs.readFileSync(resolved);

  try {
    const res = await saveExample(projectPath, activePhase, filename, buffer);
    console.log(chalk.green(`\n✔ Saved quality example for [${activePhase.toUpperCase()}]: ${res.savedPath}\n`));
  } catch (err: any) {
    console.log(chalk.red(`\n✖ Failed to save example: ${err.message}\n`));
  }
}

export async function handleReferenceCommand(
  projectPath: string,
  rawArg: string
): Promise<void> {
  const filePath = parseFilePathArg(rawArg);
  if (!filePath) {
    console.log(chalk.yellow('\n⚠ Please provide a file path: /reference <path-to-file>\n'));
    return;
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    console.log(chalk.red(`\n✖ File not found: ${resolved}\n`));
    return;
  }

  const filename = path.basename(resolved);
  const buffer = fs.readFileSync(resolved);

  try {
    const res = await saveReference(projectPath, filename, buffer);
    console.log(chalk.green(`\n✔ Saved reference document: ${res.savedPath}\n`));
  } catch (err: any) {
    console.log(chalk.red(`\n✖ Failed to save reference: ${err.message}\n`));
  }
}

export async function handleLibraryCommand(projectPath: string): Promise<void> {
  const listing = listLibrary(projectPath);
  console.log('\n' + formatLibraryTable(listing) + '\n');

  const allFiles: Array<{ name: string; value: string; kind: 'reference' | 'example'; specialistId?: string }> = [];

  for (const r of listing.references) {
    allFiles.push({
      name: `Reference: ${r.name}`,
      value: `ref:${r.name}`,
      kind: 'reference'
    });
  }

  for (const spec of Object.keys(listing.examples)) {
    for (const ex of listing.examples[spec]) {
      allFiles.push({
        name: `Example [${spec.toUpperCase()}]: ${ex.name}`,
        value: `ex:${spec}:${ex.name}`,
        kind: 'example',
        specialistId: spec
      });
    }
  }

  if (allFiles.length === 0) return;

  const action = await select({
    message: 'Library actions:',
    choices: [
      { name: 'Keep all files (Done)', value: 'DONE' },
      { name: '🗑 Delete a file...', value: 'DELETE' }
    ]
  });

  if (action === 'DELETE') {
    const fileChoice = await select({
      message: 'Select file to delete:',
      choices: [
        ...allFiles.map(f => ({ name: f.name, value: f.value })),
        { name: '✖ Cancel', value: 'CANCEL' }
      ]
    });

    if (fileChoice === 'CANCEL') return;

    const chosen = allFiles.find(f => f.value === fileChoice);
    if (!chosen) return;

    const confirmed = await confirm({
      message: `Are you sure you want to delete ${chosen.name}?`,
      default: false
    });

    if (confirmed) {
      if (chosen.kind === 'reference') {
        removeLibraryFile(projectPath, { kind: 'reference', name: chosen.value.slice(4) });
      } else {
        removeLibraryFile(projectPath, {
          kind: 'example',
          specialistId: chosen.specialistId!,
          name: chosen.value.split(':')[2]
        });
      }
      console.log(chalk.green(`\n✔ Removed ${chosen.name}\n`));
    }
  }
}
