import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface SessionStatusEvent {
  sessionId: string;
  status: string;
  timestamp: string;
}

interface QRCodeEvent {
  sessionId: string;
  qrCode: string;
  timestamp: string;
}

interface MessageEvent {
  sessionId: string;
  message: Record<string, unknown>;
  timestamp: string;
}

interface MessageAckEvent {
  sessionId: string;
  messageId: string;
  ack: number;
  ackName: string;
  chatId?: string;
  timestamp: string;
}

interface MessageReactionEvent {
  sessionId: string;
  messageId: string;
  chatId: string;
  reaction: string;
  senderId: string;
  reactions: Record<string, string>;
  timestamp: string;
}

interface MessageRevokedEvent {
  sessionId: string;
  id: string;
  chatId: string;
  from: string;
  to: string;
  body: string;
  type: string;
  timestamp: number;
}

interface WebSocketEvents {
  onSessionStatus?: (event: SessionStatusEvent) => void;
  onQRCode?: (event: QRCodeEvent) => void;
  onMessage?: (event: MessageEvent) => void;
  onMessageAck?: (event: MessageAckEvent) => void;
  onMessageReaction?: (event: MessageReactionEvent) => void;
  onMessageRevoked?: (event: MessageRevokedEvent) => void;
}

// Use current origin for WebSocket (goes through nginx proxy in Docker)
// Falls back to env var or localhost for development
const SOCKET_URL = import.meta.env.VITE_WS_URL || window.location.origin;

export function useWebSocket(events: WebSocketEvents = {}) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    // Get API key from sessionStorage (same as api.ts)
    const apiKey = sessionStorage.getItem('openwa_api_key');

    if (!apiKey) {
      console.warn('[WebSocket] No API key found, skipping connection');
      return;
    }

    socketRef.current = io(`${SOCKET_URL}/events`, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      auth: {
        apiKey,
      },
      extraHeaders: {
        'X-API-Key': apiKey,
      },
      query: {
        apiKey,
      },
    });

    socketRef.current.on('connect', () => {
      console.log('[WebSocket] Connected');
      setIsConnected(true);
    });

    socketRef.current.on('disconnect', () => {
      console.log('[WebSocket] Disconnected');
      setIsConnected(false);
    });

    socketRef.current.on('connect_error', error => {
      console.warn('[WebSocket] Connection error:', error.message);
    });
  }, []);

  const subscribe = useCallback((sessionId: string, eventsList: string[]) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('message', {
        type: 'subscribe',
        sessionId,
        events: eventsList,
      });
    }
  }, []);

  const unsubscribe = useCallback((sessionId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('message', {
        type: 'unsubscribe',
        sessionId,
      });
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [connect]);

  // Register event handlers
  useEffect(() => {
    if (!socketRef.current) return;

    const socket = socketRef.current;

    const handleIncomingMessage = (msg: any) => {
      if (msg && msg.type === 'event' && msg.payload) {
        const { event, sessionId, data } = msg.payload;
        if (event === 'session.status' && events.onSessionStatus) {
          events.onSessionStatus({ sessionId, status: data.status, timestamp: msg.timestamp });
        } else if (event === 'session.qr' && events.onQRCode) {
          events.onQRCode({ sessionId, qrCode: data.qrCode, timestamp: msg.timestamp });
        } else if ((event === 'message.received' || event === 'message.sent') && events.onMessage) {
          events.onMessage({ sessionId, message: data, timestamp: msg.timestamp });
        } else if (event === 'message.ack' && events.onMessageAck) {
          events.onMessageAck({
            sessionId,
            messageId: data.messageId,
            ack: data.ack,
            ackName: data.ackName,
            chatId: data.chatId,
            timestamp: msg.timestamp,
          });
        } else if (event === 'message.reaction' && events.onMessageReaction) {
          events.onMessageReaction({
            sessionId,
            messageId: data.messageId,
            chatId: data.chatId,
            reaction: data.reaction,
            senderId: data.senderId,
            reactions: data.reactions,
            timestamp: msg.timestamp,
          });
        } else if (event === 'message.revoked' && events.onMessageRevoked) {
          events.onMessageRevoked({
            sessionId,
            id: data.id,
            chatId: data.chatId,
            from: data.from,
            to: data.to,
            body: data.body,
            type: data.type,
            timestamp: data.timestamp,
          });
        }
      }
    };

    socket.on('message', handleIncomingMessage);

    return () => {
      socket.off('message', handleIncomingMessage);
    };
  }, [events]);

  return { isConnected, subscribe, unsubscribe };
}

