import { input } from '@inquirer/prompts';
import { spawn, execSync } from 'child_process';
import { OpenRouterClient } from '../openrouter/client.js';

// Ensure SoX is on PATH on Windows (for child_process.spawn to find it)
function ensureSoxOnPath(): void {
  if (process.platform !== 'win32') return;
  const currentPath = process.env.PATH || '';
  const soxPath = 'C:\\tools\\sox\\sox-14.4.2';
  if (!currentPath.toLowerCase().includes(soxPath.toLowerCase())) {
    process.env.PATH = `${soxPath};${currentPath}`;
  }
}

ensureSoxOnPath();

export function isVoiceCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (trimmed === '/voice' || trimmed.startsWith('/voice ')) return true;
  if (trimmed === '\x00v' || trimmed === '\x16') return true;
  return false;
}

export interface RecordResult {
  buffer: Buffer;
  durationMs: number;
}

/**
 * Records audio from the microphone by spawning SoX directly.
 * Writes to a temp file to avoid pipe/stream issues.
 * The user presses Enter (via @inquirer/input) to stop recording.
 */
export async function recordAudio(): Promise<RecordResult> {
  const tmpFile = `${process.env.TEMP || '/tmp'}/starn-voice-${Date.now()}.wav`;

  const startTime = Date.now();

  // Spawn sox: capture from default microphone, write to temp file
  const sox = spawn('sox', [
    '-b', '16',
    '--endian', 'little',
    '-c', '1',
    '-r', '16000',
    '-e', 'signed-integer',
    '-t', 'waveaudio', 'default',
    tmpFile
  ], {
    stdio: ['ignore', 'ignore', 'pipe']
  });

  // Log stderr for debugging
  let stderrLog = '';
  sox.stderr.on('data', (chunk: Buffer) => {
    stderrLog += chunk.toString();
  });

  // Handle spawn errors (e.g., sox not found)
  const spawnError = new Promise<never>((_, reject) => {
    sox.on('error', (err: Error) => {
      reject(new Error(
        `Failed to start SoX: ${err.message}. ` +
        'Ensure SoX is installed. On Windows: download from https://sourceforge.net/projects/sox/files/sox/'
      ));
    });
  });

  // Wait for user to press Enter to stop recording
  const stopPromise = (async (): Promise<RecordResult> => {
    await input({ message: 'Press Enter to stop recording' });
    // Kill sox process
    sox.kill('SIGTERM');
    // On Windows, SIGTERM might not work, so also try taskkill
    if (process.platform === 'win32' && sox.pid) {
      try {
        execSync(`taskkill /F /T /PID ${sox.pid}`, { stdio: 'ignore' });
      } catch {
        // ignore
      }
    }
    // Wait briefly for file to be written
    await new Promise(r => setTimeout(r, 500));
    const durationMs = Date.now() - startTime;

    // Read the temp file
    const fs = await import('fs');
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(tmpFile);
    } catch {
      buffer = Buffer.alloc(0);
    }

    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

    return { buffer, durationMs };
  })();

  return Promise.race([stopPromise, spawnError]) as Promise<RecordResult>;
}

/**
 * Full voice prompt flow: record audio, transcribe it, return the text.
 */
export async function captureVoicePrompt(client: OpenRouterClient): Promise<string> {
  const result = await recordAudio();

  if (result.buffer.length < 100) {
    return '';
  }

  const transcription = await client.transcribeAudio(result.buffer);
  return transcription.text;
}