import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

export interface UseVoiceRecorderReturn {
  recording: boolean;
  startRecording: () => void;
  stopRecording: () => Promise<string | null>;
  error: string | null;
}

export function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const resolveRef = useRef<((text: string | null) => void) | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const startRecording = useCallback(() => {
    setError(null);
    chunksRef.current = [];

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        streamRef.current = stream;
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        const recorder = new MediaRecorder(stream, { mimeType });

        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        recorder.onerror = () => {
          setError('MediaRecorder error');
          setRecording(false);
          stream.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        setRecording(true);
      })
      .catch(err => {
        const msg = err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access denied'
          : 'Microphone access failed';
        setError(msg);
      });
  }, []);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return null;

    return new Promise<string | null>(resolve => {
      resolveRef.current = resolve;

      recorder.onstop = async () => {
        const stream = streamRef.current;
        if (stream) {
          stream.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        setRecording(false);

        try {
          const text = await api.transcribeAudio(blob);
          resolve(text);
        } catch (err: any) {
          setError(err?.message ?? 'Transcription request failed');
          resolve(null);
        }
      };

      recorder.stop();
    });
  }, []);

  return { recording, startRecording, stopRecording, error };
}
