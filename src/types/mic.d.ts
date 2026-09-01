declare module 'mic' {
  interface MicOptions {
    rate?: string;
    channels?: string;
    fileType?: string;
    debug?: boolean;
    exitOnSilence?: number;
  }

  interface MicInstance {
    start(): void;
    stop(): void;
    getAudioStream(): NodeJS.ReadableStream;
  }

  interface MicStatic {
    (options?: MicOptions): MicInstance;
  }

  const mic: MicStatic;
  export default mic;
}