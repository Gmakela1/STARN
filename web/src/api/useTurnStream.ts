import { useCallback, useRef, useState } from 'react';
import { CriticResult, PendingCheckpoint } from '../types/api';

export interface ChatEntry {
  id: string;
  role: 'user' | 'agent' | 'system';
  specialistName?: string;
  text: string;
  criticResult?: CriticResult;
  requiresReview?: boolean;
  aborted?: boolean;
}

export interface TurnStreamState {
  entries: ChatEntry[];
  busy: boolean;
  status: string | null;
  toolActivity: string | null;
  checkpoint: PendingCheckpoint | null;
  error: string | null;
}

let idCounter = 0;
const nextId = () => `msg-${Date.now()}-${idCounter++}`;

/**
 * Streams POST /api/turns SSE events into chat state. fetch + ReadableStream
 * is used (not EventSource) because the turn endpoint is a POST.
 */
export function useTurnStream() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const [checkpoint, setCheckpoint] = useState<PendingCheckpoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const appendEntry = useCallback((entry: Omit<ChatEntry, 'id'>) => {
    setEntries(prev => [...prev, { ...entry, id: nextId() }]);
  }, []);

  const handleEvent = useCallback((event: string, data: any) => {
    switch (event) {
      case 'status':
        setStatus(String(data.status ?? ''));
        break;
      case 'tool_call':
        setToolActivity(String(data.tool ?? ''));
        break;
      case 'checkpoint':
        setCheckpoint(data as PendingCheckpoint);
        break;
      case 'complete':
        appendEntry({
          role: 'agent',
          specialistName: data.specialistName,
          text: String(data.output ?? ''),
          criticResult: data.criticResult,
          requiresReview: Boolean(data.requiresReview),
          aborted: Boolean(data.aborted)
        });
        break;
      case 'error':
        setError(String(data.message ?? 'Turn failed'));
        appendEntry({ role: 'system', text: `Error: ${data.message ?? 'Turn failed'}` });
        break;
    }
  }, [appendEntry]);

  const sendTurn = useCallback(async (prompt: string, options?: { silentUserEntry?: boolean }) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setStatus('Classifying request…');
    setToolActivity(null);
    if (!options?.silentUserEntry) {
      appendEntry({ role: 'user', text: prompt });
    }

    try {
      const res = await fetch('/api/turns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) {
        const envelope = await res.json().catch(() => null);
        throw new Error(envelope?.error ?? `Turn request failed (${res.status})`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let eventName = 'message';
          let dataLine = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataLine += line.slice(6);
          }
          if (dataLine) {
            try {
              handleEvent(eventName, JSON.parse(dataLine));
            } catch {
              // skip malformed frame
            }
          }
        }
      }
    } catch (err: any) {
      setError(err?.message ?? 'Connection lost');
      appendEntry({ role: 'system', text: `Connection error: ${err?.message ?? 'unknown'}` });
    } finally {
      busyRef.current = false;
      setBusy(false);
      setStatus(null);
      setToolActivity(null);
    }
  }, [appendEntry, handleEvent]);

  const abortTurn = useCallback(async () => {
    try {
      await fetch('/api/turns/abort', { method: 'POST' });
    } catch {
      // best effort
    }
  }, []);

  const clearCheckpoint = useCallback(() => setCheckpoint(null), []);
  const restoreCheckpoint = useCallback((cp: PendingCheckpoint) => setCheckpoint(cp), []);

  const state: TurnStreamState = { entries, busy, status, toolActivity, checkpoint, error };
  return { ...state, sendTurn, abortTurn, clearCheckpoint, restoreCheckpoint, appendEntry };
}
