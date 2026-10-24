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

const DEFAULT_STATUS: AutopilotStatusResponse = {
  enabled: false,
  running: false,
  docStatus: {},
  blocks: 0,
  passedCount: 0,
  totalPhases: 13
};

/**
 * SSE connection to /api/autopilot/events with auto-reconnect and 3s poll fallback.
 */
export function useAutopilotEvents(): AutopilotEventsState {
  const [status, setStatus] = useState<AutopilotStatusResponse | null>(null);
  const [portalItems, setPortalItems] = useState<PortalItem[]>([]);
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
                    case 'autopilot':
                      setStatus(parsed.status ?? parsed);
                      break;
                    case 'question':
                      setPortalItems(prev => [...prev, parsed.item ?? parsed]);
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
