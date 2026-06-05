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
}

export const api = {
  postChat: async (message: string, volume?: number): Promise<{ status: string; chatId?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, volume, timestamp: Date.now() }),
      });
      return res.json();
    } catch (error) {
      console.error('Chat request failed:', error);
      return { status: 'error' };
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

  getChatHistory: async (limit = 50): Promise<any[]> => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/history?limit=${limit}`);
      return res.json();
    } catch (error) {
      console.error('Get chat history failed:', error);
      return [];
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

export const connectStream = (onMessage: (msg: any) => void): Socket | null => {
  // 只保留最新的监听器
  messageHandler = onMessage;

  if (socket?.connected) {
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
  });

  socket.on('disconnect', () => {
    console.log('Socket.IO disconnected');
  });

  // 监听所有信令事件，统一转发给单一处理器
  const events = ['now-playing', 'control', 'chat-stream', 'chat-end', 'playlist-update'];
  events.forEach((event) => {
    socket?.on(event, (data) => {
      messageHandler?.({ type: event, data });
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
