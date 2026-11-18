import { useEffect, useRef, useState } from 'react';
import { getAdminMemoryToken } from '../api';
import type { RealtimeWsEvent } from '../types';

export function useRealtimeSocket(
  onEvent: (event: RealtimeWsEvent) => void,
  options?: { qrToken?: string }
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  const qrToken = options?.qrToken;

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const qs = new URLSearchParams();
      const adminToken = getAdminMemoryToken();
      if (adminToken) {
        qs.set('token', adminToken);
      } else if (qrToken) {
        qs.set('qr', qrToken);
      } else {
        return;
      }

      const wsUrl = `${protocol}//${window.location.host}/api/ws?${qs.toString()}`;

      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        if (disposed) return;
        const wasReconnect = attempt > 0;
        attempt = 0;
        setConnected(true);

        if (wasReconnect) {
          onEventRef.current({ type: 'REQUEST_UPDATED' });
        }

        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 25000);
      };

      ws.onmessage = (evt) => {
        if (disposed) return;
        try {
          const parsed = JSON.parse(evt.data) as RealtimeWsEvent;
          if (parsed.type !== 'PONG' && parsed.type !== 'CONNECTED') {
            onEventRef.current(parsed);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
        }
        if (!disposed) {
          setConnected(false);
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      attempt += 1;
      const delay = Math.min(4000, 800 * attempt);
      reconnectTimeout = setTimeout(connect, delay);
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (pingInterval) clearInterval(pingInterval);
      ws?.close();
    };
  }, [qrToken]);

  return { connected };
}
