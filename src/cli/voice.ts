import { OpenRouterClient } from '../openrouter/client.js';

export function isVoiceCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  // /voice trigger
  if (trimmed === '/voice' || trimmed.startsWith('/voice ')) return true;
  // Alt+V (0x00 prefix + 'v')
  if (trimmed === '\x00v' || trimmed === '\x16') return true;
  return false;
}

export interface RecordResult {
  buffer: Buffer;
  durationMs: number;
}

/**
 * Records audio from the microphone until the user presses Enter.
 * Returns the raw PCM buffer and duration.
 * Requires `sox` (Mac/Windows) or `arecord` (Linux) to be installed.
 */
export function recordAudio(): Promise<RecordResult> {
  return new Promise((resolve, reject) => {
    // Dynamic import of 'mic' - it's only loaded when /voice is used
    import('mic').then(({ default: Mic }) => {
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

      micInputStream.on('error', (err: Error) => {
        reject(new Error(`Microphone error: ${err.message}. Ensure sox (Mac/Windows) or arecord (Linux) is installed.`));
      });

      micInputStream.on('silence', () => {
        micInstance.stop();
      });

      // Handle the Enter key to stop recording
      // We listen for stdin 'data' events
      const onData = (key: Buffer) => {
        const keyStr = key.toString();
        // Enter key (0x0D or 0x0A)
        if (keyStr === '\r' || keyStr === '\n' || keyStr === '\x0D' || keyStr === '\x0A') {
          process.stdin.removeListener('data', onData);
          micInstance.stop();
          const durationMs = Date.now() - startTime;
          const buffer = Buffer.concat(chunks);
          resolve({ buffer, durationMs });
        }
      };

      process.stdin.setRawMode?.(true);
      process.stdin.on('data', onData);

      micInstance.start();

    }).catch(() => {
      reject(new Error(
        'Voice recording requires the "mic" npm package. Run: npm install mic\n' +
        'Also requires sox (Mac/Windows) or arecord (Linux) to be installed:\n' +
        '- Mac: brew install sox\n' +
        '- Windows: choco install sox or download from https://sourceforge.net/projects/sox/\n' +
        '- Linux: apt-get install alsa-utils'
      ));
    });
  });
}

/**
 * Full voice prompt flow: record audio, transcribe it, return the text.
 * Restores stdin raw mode on completion.
 */
export async function captureVoicePrompt(client: OpenRouterClient): Promise<string> {
  let result: RecordResult | null = null;
  try {
    result = await recordAudio();
  } finally {
    // Restore raw mode
    try {
      process.stdin.setRawMode?.(false);
    } catch (_e) {
      // ignore
    }
  }

  if (!result || result.buffer.length < 100) {
    return '';
  }

  const transcription = await client.transcribeAudio(result.buffer);
  return transcription.text;
}