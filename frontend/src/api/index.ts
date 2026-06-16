/**
 * Uradio 前端 API 契约定义
 */
import { io, Socket } from 'socket.io-client';

const API_BASE = 'http://localhost:3000';

export interface ChatMessage {
  id: string;
  role: 'user' | 'dj';
  content: string;
  timestamp: number;
  sessionId?: number | null;
}

export interface ChatSession {
  id: number;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export const api = {
  postChat: async (message: string, volume?: number, sessionId?: number | null): Promise<{ status: string; chatId?: string; sessionId?: number; message?: string }> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const body: any = { message, volume, timestamp: Date.now() };
      if (sessionId) body.sessionId = String(sessionId);
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.json();
    } catch (error: any) {
      console.error('Chat request failed:', error);
      return { status: 'error', message: error?.name === 'AbortError' ? '请求超时' : '网络错误' };
    }
  },

  getNow: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/now`);
      return res.json();
    } catch (error) {
      console.error('Get now playing failed:', error);
      return null;
    }
  },

  postControl: async (command: string, payload?: any): Promise<{ status: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, payload }),
      });
      return res.json();
    } catch (error) {
      console.error('Control request failed:', error);
      return { status: 'error' };
    }
  },

  getPlaylist: async () => {
    try {
      const res = await fetch(`${API_BASE}/playlist`);
      return res.json();
    } catch (error) {
      console.error('Get playlist failed:', error);
      return [];
    }
  },

  getLyric: async (id: string): Promise<{ lyric: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/lyric/${id}`);
      return res.json();
    } catch (error) {
      console.error('Get lyric failed:', error);
      return { lyric: '' };
    }
  },

  getPlanToday: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/plan/today`);
      return res.json();
    } catch (error) {
      console.error('Get plan today failed:', error);
      return null;
    }
  },

  prefetchNext: async (currentSongId: string, volume = 0.5) => {
    try {
      const res = await fetch(`${API_BASE}/api/tts/prefetch?current=${currentSongId}&volume=${volume}`);
      return res.json();
    } catch (error) {
      console.error('Prefetch failed:', error);
      return null;
    }
  },

  getChatHistory: async (limit = 50, sessionId?: number | null): Promise<any[]> => {
    try {
      let url = `${API_BASE}/api/chat/history?limit=${limit}`;
      if (sessionId) url += `&sessionId=${sessionId}`;
      const res = await fetch(url);
      return res.json();
    } catch (error) {
      console.error('Get chat history failed:', error);
      return [];
    }
  },

  // ─── 会话管理 ────────────────────────────────

  getSessions: async (): Promise<{ status: string; sessions: ChatSession[] }> => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions`);
      return res.json();
    } catch (error) {
      console.error('Get sessions failed:', error);
      return { status: 'error', sessions: [] };
    }
  },

  createSession: async (title?: string): Promise<{ status: string; session?: ChatSession }> => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      return res.json();
    } catch (error) {
      console.error('Create session failed:', error);
      return { status: 'error' };
    }
  },

  getSessionMessages: async (sessionId: number): Promise<{ status: string; session?: ChatSession; messages?: any[] }> => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/${sessionId}/messages`);
      return res.json();
    } catch (error) {
      console.error('Get session messages failed:', error);
      return { status: 'error' };
    }
  },

  deleteSession: async (sessionId: number): Promise<{ status: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      return res.json();
    } catch (error) {
      console.error('Delete session failed:', error);
      return { status: 'error' };
    }
  },

  clearChatHistory: async (): Promise<boolean> => {
    try {
      await fetch(`${API_BASE}/api/chat/history`, { method: 'DELETE' });
      return true;
    } catch (error) {
      console.error('Clear chat history failed:', error);
      return false;
    }
  },

  getSegueNext: async (): Promise<{
    text: string;
    ttsBase64: string;
    songTitle?: string;
    artist?: string;
    type?: 'opening' | 'segue' | 'recommendation';
    recommendedSongs?: { id: string; name: string; artist: string; cover: string; reason: string }[];
  } | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/segue/next`);
      return res.json();
    } catch (error) {
      console.error('Get segue failed:', error);
      return null;
    }
  },

  getOpening: async (volume = 0.5): Promise<{ text: string; ttsBase64: string; type: string } | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/tts/opening?volume=${volume}`);
      return res.json();
    } catch (error) {
      console.error('Get opening failed:', error);
      return null;
    }
  },
};

// Socket.IO 连接（单例）
let socket: Socket | null = null;
let messageHandler: ((msg: any) => void) | null = null;

export const connectStream = (onMessage: (msg: any) => void, onStatus?: (connected: boolean) => void): Socket | null => {
  // 只保留最新的监听器
  messageHandler = onMessage;

  if (socket?.connected) {
    onStatus?.(true);
    return socket;
  }

  socket = io(`${API_BASE}/stream`, {
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionAttempts: 10,
  });

  socket.on('connect', () => {
    console.log('Socket.IO connected');
    onStatus?.(true);
  });

  socket.on('disconnect', () => {
    console.log('Socket.IO disconnected');
    onStatus?.(false);
  });

  // 监听所有信令事件，二进制数据通过额外参数传递
  const events = ['now-playing', 'control', 'chat-stream', 'chat-end', 'playlist-update'];
  events.forEach((event) => {
    socket?.on(event, (data: any, binary: ArrayBuffer | undefined) => {
      messageHandler?.({ type: event, data, binary });
    });
  });

  socket.on('connect_error', (error) => {
    console.error('Socket.IO error:', error.message);
  });

  return socket;
};

export const disconnectStream = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  messageHandler = null;
};

export const sendWsMessage = (event: string, data: any) => {
  if (socket?.connected) {
    socket.emit(event, data);
  }
};
