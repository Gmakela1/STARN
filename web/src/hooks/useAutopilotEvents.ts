import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { AutopilotStatusResponse, PortalItem } from '../types/api';

export interface AutopilotEventsState {
  status: AutopilotStatusResponse | null;
  portalItems: PortalItem[];
  connected: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  resume: (docId?: string) => Promise<void>;
  submitAnswer: (id: string, answer: string) => Promise<void>;
  dismissItem: (id: string) => Promise<void>;
}

/** Raw events from the /api/autopilot/events SSE stream, for live chat updates. */
export type AutopilotLiveEvent =
  | { kind: 'start'; total: number }
  | { kind: 'phase'; phaseId: string; status: string; name?: string }
  | { kind: 'question'; item: PortalItem }
  | { kind: 'parked'; item: PortalItem }
  | { kind: 'status'; message: string }
  | { kind: 'tool_call'; tool: string; args: unknown }
  | { kind: 'complete'; result: { passed: string[]; parked: string[] }; reason?: 'finished' | 'stopped' }
  | { kind: 'error'; message: string }
  // Answer-queue frames (§1.1) — forwarded to consumers, never merged into status.
  | { kind: 'answer_queued'; itemId: string; title: string }
  | { kind: 'answer_applying'; itemId: string }
  | { kind: 'answer_applied'; itemId: string; item: PortalItem; affectedDocs: string[] }
  | { kind: 'answer_failed'; itemId: string; error: string };

/**
 * Creates a useAutopilotEvents hook. Pass an optional onEvent callback to
 * receive raw SSE events for live UI updates (e.g. appending chat entries).
 */
export function useAutopilotEvents(onEvent?: (ev: AutopilotLiveEvent) => void): AutopilotEventsState {
  const [status, setStatus] = useState<AutopilotStatusResponse | null>(null);
  const [portalItems, setPortalItems] = useState<PortalItem[]>([]);

  const DEFAULT_STATUS: AutopilotStatusResponse = {
    enabled: false,
    running: false,
    docStatus: {},
    blocks: 0,
    passedCount: 0,
    totalPhases: 13
  };

  const [connected, setConnected] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scheduleReconnect = useCallback(() => {
    if (retryRef.current) clearTimeout(retryRef.current);
    retryRef.current = setTimeout(() => {
      connect();
    }, 3000);
  }, []);

  const connect = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const abort = new AbortController();
    abortRef.current = abort;

    fetch('/api/autopilot/events', { signal: abort.signal })
      .then(res => {
        if (!res.ok || !res.body) throw new Error('SSE connection failed');
        setConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const read = () => {
          reader.read().then(({ done, value }) => {
            if (done) {
              setConnected(false);
              scheduleReconnect();
              return;
            }
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
                  const parsed = JSON.parse(dataLine);
                  switch (eventName) {
                    case 'autopilot': {
                      const st = parsed.status ?? parsed;
                      const isAnswerFrame =
                        typeof st?.kind === 'string' &&
                        typeof st?.itemId === 'string' &&
                        ['answer_queued', 'answer_applying', 'answer_applied', 'answer_failed'].includes(st.kind);
                      if (isAnswerFrame) { onEvent?.(st); break; } // answer frames: forward only, never merge into status
                      setStatus(prev => {
                        // 'complete' and 'error' events mean the run finished
                        if (st.kind === 'complete' || st.kind === 'error') {
                          return { ...prev, running: false, ...st.result };
                        }
                        return { ...prev, ...st };
                      });
                      onEvent?.(st);
                      break;
                    }
                    case 'question': {
                      // Schema gate (defense-in-depth): only well-formed items with
                      // a string id enter state; duplicate ids are coalesced so the
                      // panel's keyed chips stay deterministic (security INFO).
                      const item = parsed.item ?? parsed;
                      if (typeof item?.id !== 'string') break;
                      setPortalItems(prev => (prev.some(i => i.id === item.id) ? prev : [...prev, item]));
                      onEvent?.({ kind: 'question', item });
                      break;
                    }
                    case 'status':
                      onEvent?.({ kind: 'status', message: parsed.message });
                      break;
                    case 'tool_call':
                      onEvent?.({ kind: 'tool_call', tool: parsed.tool, args: parsed.args });
                      break;
                  }
                } catch {
                  // skip malformed frame
                }
              }
            }
            read();
          }).catch(() => {
            setConnected(false);
            scheduleReconnect();
          });
        };
        read();
      })
      .catch(() => {
        setConnected(false);
        scheduleReconnect();
      });
  }, [scheduleReconnect]);

  // 3s poll fallback for status
  useEffect(() => {
    const poll = async () => {
      try {
        const s = await api.fetchAutopilotStatus();
        setStatus(s);
        const portalRes = await api.fetchPortalItems({ status: 'open' });
        setPortalItems(portalRes.items);
      } catch {
        // poll failed — SSE may still be connected
      }
    };
    void poll();
    pollRef.current = setInterval(poll, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (abortRef.current) abortRef.current.abort();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, []);

  // Initial SSE connect
  useEffect(() => {
    connect();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [connect]);

  const start = useCallback(async () => {
    await api.autopilotStart();
    setStatus(prev => prev ? { ...prev, running: true } : { ...DEFAULT_STATUS, running: true });
  }, []);

  const stop = useCallback(async () => {
    await api.autopilotStop();
    setStatus(prev => prev ? { ...prev, running: false } : DEFAULT_STATUS);
  }, []);

  const resume = useCallback(async (docId?: string) => {
    await api.autopilotResume(docId);
    setStatus(prev => prev ? { ...prev, running: true } : { ...DEFAULT_STATUS, running: true });
  }, []);

  const submitAnswer = useCallback(async (id: string, answer: string) => {
    await api.submitPortalAnswer(id, answer);
  }, []);

  const dismissItem = useCallback(async (id: string) => {
    await api.dismissPortalItem(id);
    setPortalItems(prev => prev.filter(i => i.id !== id));
  }, []);

  return { status, portalItems, connected, start, stop, resume, submitAnswer, dismissItem };
}
