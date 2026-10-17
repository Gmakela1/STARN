import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractTextFromPdf } from '../tools/handlers/pdf-extractor.js';

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_EXAMPLE_EXTS = new Set(['.md', '.txt', '.pdf']);
const ALLOWED_REFERENCE_EXTS = new Set([
  '.md',
  '.txt',
  '.pdf',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp'
]);

export interface FileEntry {
  name: string;
  size: number;
  modified: string;
}

export interface LibraryListing {
  references: FileEntry[];
  examples: Record<string, FileEntry[]>;
}

function validateFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error(`Invalid filename: "${filename}". Directory separators and ".." are not allowed.`);
  }
  return trimmed;
}

function findNonCollidingName(dir: string, filename: string): string {
  if (!fs.existsSync(path.join(dir, filename))) {
    return filename;
  }

  const ext = path.extname(filename);
  const base = path.basename(filename, ext);

  let counter = 2;
  while (true) {
    const candidate = `${base}-${counter}${ext}`;
    if (!fs.existsSync(path.join(dir, candidate))) {
      return candidate;
    }
    counter++;
  }
}

/**
 * Saves a quality example for a specialist.
 * Supported: .md, .txt, .pdf.
 * For .pdf, text is extracted and saved as <filename>.pdf.md.
 */
export async function saveExample(
  projectPath: string,
  specialistId: string,
  filename: string,
  buffer: Buffer
): Promise<{ savedPath: string; filename: string }> {
  const safeName = validateFilename(filename);
  const safeSpecialist = validateFilename(specialistId);

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size (${buffer.length} bytes) exceeds maximum limit of 10MB.`);
  }

  const ext = path.extname(safeName).toLowerCase();
  if (!ALLOWED_EXAMPLE_EXTS.has(ext)) {
    throw new Error(`Unsupported file type "${ext}" for examples. Allowed: .md, .txt, .pdf`);
  }

  const examplesDir = path.join(projectPath, 'examples', safeSpecialist);
  fs.mkdirSync(examplesDir, { recursive: true });

  if (ext === '.pdf') {
    // Extract text from PDF
    const tempPath = path.join(os.tmpdir(), `starn-pdf-${Date.now()}-${safeName}`);
    fs.writeFileSync(tempPath, buffer);
    let extractedText = '';
    try {
      extractedText = await extractTextFromPdf(tempPath);
    } finally {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
    }

    if (!extractedText || extractedText.startsWith('(No extractable text')) {
      throw new Error(`No extractable text found in PDF: "${safeName}". Scanned/image-only PDFs are not supported as examples.`);
    }

    const targetName = safeName.endsWith('.pdf') ? `${safeName}.md` : `${safeName}.pdf.md`;
    const finalName = findNonCollidingName(examplesDir, targetName);
    const targetPath = path.join(examplesDir, finalName);
    fs.writeFileSync(targetPath, extractedText, 'utf-8');

    return {
      savedPath: `examples/${safeSpecialist}/${finalName}`,
      filename: finalName
    };
  }

  // .md or .txt
  const finalName = findNonCollidingName(examplesDir, safeName);
  const targetPath = path.join(examplesDir, finalName);
  fs.writeFileSync(targetPath, buffer);

  return {
    savedPath: `examples/${safeSpecialist}/${finalName}`,
    filename: finalName
  };
}

/**
 * Saves a reference document (datasheet, ICD, spec sheet, diagram) in reference/
 */
export async function saveReference(
  projectPath: string,
  filename: string,
  buffer: Buffer
): Promise<{ savedPath: string; filename: string }> {
  const safeName = validateFilename(filename);

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size (${buffer.length} bytes) exceeds maximum limit of 10MB.`);
  }

  const ext = path.extname(safeName).toLowerCase();
  if (!ALLOWED_REFERENCE_EXTS.has(ext)) {
    throw new Error(`Unsupported file type "${ext}" for references. Allowed: .md, .txt, .pdf, .csv, .png, .jpg, .webp`);
  }

  const refDir = path.join(projectPath, 'reference');
  fs.mkdirSync(refDir, { recursive: true });

  const finalName = findNonCollidingName(refDir, safeName);
  const targetPath = path.join(refDir, finalName);
  fs.writeFileSync(targetPath, buffer);

  return {
    savedPath: `reference/${finalName}`,
    filename: finalName
  };
}

/**
 * Lists all reference documents and specialist quality examples in the project.
 */
export function listLibrary(projectPath: string): LibraryListing {
  const references: FileEntry[] = [];
  const examples: Record<string, FileEntry[]> = {};

  const refDir = path.join(projectPath, 'reference');
  if (fs.existsSync(refDir)) {
    for (const f of fs.readdirSync(refDir)) {
      if (f.startsWith('.') || f === 'README.md') continue;
      const fullPath = path.join(refDir, f);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          references.push({
            name: f,
            size: stat.size,
            modified: stat.mtime.toISOString()
          });
        }
      } catch {}
    }
  }

  const exBaseDir = path.join(projectPath, 'examples');
  if (fs.existsSync(exBaseDir)) {
    for (const specId of fs.readdirSync(exBaseDir)) {
      const specDir = path.join(exBaseDir, specId);
      if (!fs.statSync(specDir).isDirectory()) continue;
      const specFiles: FileEntry[] = [];

      for (const f of fs.readdirSync(specDir)) {
        if (f.startsWith('.')) continue;
        const fullPath = path.join(specDir, f);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            specFiles.push({
              name: f,
              size: stat.size,
              modified: stat.mtime.toISOString()
            });
          }
        } catch {}
      }

      if (specFiles.length > 0) {
        examples[specId] = specFiles;
      }
    }
  }

  return { references, examples };
}

/**
 * Removes a library file (reference or specialist quality example).
 */
export function removeLibraryFile(
  projectPath: string,
  target: { kind: 'reference'; name: string } | { kind: 'example'; specialistId: string; name: string }
): void {
  const safeName = validateFilename(target.name);

  let targetPath: string;
  if (target.kind === 'reference') {
    targetPath = path.join(projectPath, 'reference', safeName);
  } else {
    const safeSpec = validateFilename(target.specialistId);
    targetPath = path.join(projectPath, 'examples', safeSpec, safeName);
  }

  // Path resolution check: must stay within projectPath
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(path.resolve(projectPath))) {
    throw new Error('Invalid path: file target is outside of project directory.');
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`File not found: ${target.name}`);
  }

  fs.unlinkSync(resolved);
}
