import { input } from '@inquirer/prompts';
import { OpenRouterClient } from '../openrouter/client.js';

// Ensure SoX is on PATH on Windows (for the mic package to find it)
function ensureSoxOnPath(): void {
  if (process.platform !== 'win32') return;
  const currentPath = process.env.PATH || '';
  const soxPaths = [
    'C:\\tools\\sox\\sox-14.4.2',
    'C:/tools/sox/sox-14.4.2'
  ];
  for (const p of soxPaths) {
    const sep = '\\';
    const normalized = p.replace(/\//g, sep);
    if (!currentPath.includes(normalized)) {
      process.env.PATH = `${normalized};${currentPath}`;
    }
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
 * Records audio from the microphone.
 * Uses @inquirer/input to wait for the user to press Enter to stop (handles stdin properly).
 * Returns the raw WAV buffer and duration.
 */
export async function recordAudio(): Promise<RecordResult> {
  const { default: Mic } = await import('mic');

  const micInstance = Mic({
    rate: '16000',
    channels: '1',
    fileType: 'wav',
    debug: false
  });

  const micInputStream = micInstance.getAudioStream();
  const chunks: Buffer[] = [];
  const startTime = Date.now();

  micInputStream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  const micError = new Promise<never>((_, reject) => {
    micInputStream.on('error', (err: Error) => {
      reject(new Error(`Microphone error: ${err.message}. Ensure sox (Mac/Windows) or arecord (Linux) is installed.`));
    });
  });

  // Start recording
  micInstance.start();

  // Wait for the user to press Enter using @inquirer/input (handles stdin properly)
  // This is reliable because @inquirer manages stdin state correctly
  const stopPromise = (async () => {
    await input({ message: 'Press Enter to stop recording' });
    micInstance.stop();
    const durationMs = Date.now() - startTime;
    const buffer = Buffer.concat(chunks);
    return { buffer, durationMs };
  })();

  // Race: if mic errors, reject; otherwise return the recording
  return Promise.race([stopPromise, micError]) as Promise<RecordResult>;
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