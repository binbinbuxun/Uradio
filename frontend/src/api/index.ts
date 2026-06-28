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
  source?: 'chat' | 'radio_auto';
}

export interface ChatSession {
  id: number;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export type RadioMode = 'manual' | 'auto';
export type QueueInsertMode = 'play_now' | 'play_next' | 'append';
export interface PlayHistoryItem {
  id: number;
  songId: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  trigger: string;
  playedAt: string;
  chatId: string | null;
  position: number;
}

export interface QueueTrack {
  id: string;
  queueItemId?: string;
  name: string;
  title?: string;
  artist: string;
  cover?: string;
  coverUrl?: string;
  url: string;
  source?: string;
  reason?: string;
  status?: string;
  insertPolicy?: string;
}

export interface QueueCandidate extends QueueTrack {
  candidateId: string;
  source: 'chat' | 'radio_auto' | 'search';
  createdAt?: number;
}

export interface BootstrapInfo {
  source: string;
  label: string;
  reservoirCount: number;
  initializedAt: number;
}

export interface QueueState {
  queueId?: string;
  version?: number;
  playlist: QueueTrack[];
  upNext?: QueueTrack[];
  currentIndex: number;
  action: string;
  currentTrackId?: string | null;
  bootstrap?: BootstrapInfo | null;
  candidates?: {
    chat: QueueCandidate[];
    radio: QueueCandidate[];
    search: QueueCandidate[];
  };
  historyCount?: number;
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

  postControl: async (command: string, payload?: any): Promise<{ status: string; queue?: QueueState }> => {
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

  getQueue: async (): Promise<QueueState> => {
    try {
      const res = await fetch(`${API_BASE}/api/queue`);
      return res.json();
    } catch (error) {
      console.error('Get queue failed:', error);
      return { playlist: [], currentIndex: 0, action: 'pause', currentTrackId: null };
    }
  },

  addQueueTrack: async (
    payload: {
      track?: any;
      tracks?: any[];
      insertAt?: number;
      playNow?: boolean;
      source?: 'manual' | 'chat' | 'radio_auto';
    },
  ): Promise<{ status: string; queue?: QueueState; message?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/queue/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.json();
    } catch (error) {
      console.error('Add queue track failed:', error);
      return { status: 'error', message: '网络错误' };
    }
  },

  queueCommand: async (
    payload: {
      command: QueueInsertMode | 'remove' | 'clear_upcoming' | 'accept_candidate' | 'reject_candidate';
      track?: any;
      tracks?: any[];
      candidateId?: string;
      index?: number;
      fromIndex?: number;
      toIndex?: number;
      source?: 'manual' | 'chat' | 'radio_auto';
      mode?: QueueInsertMode;
    },
  ): Promise<{ status: string; queue?: QueueState; message?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/queue/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.json();
    } catch (error) {
      console.error('Queue command failed:', error);
      return { status: 'error', message: '网络错误' };
    }
  },

  acceptCandidate: async (
    candidateId: string,
    mode: QueueInsertMode,
  ): Promise<{ status: string; queue?: QueueState; message?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/candidates/${candidateId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      return res.json();
    } catch (error) {
      console.error('Accept candidate failed:', error);
      return { status: 'error', message: '网络错误' };
    }
  },

  rejectCandidate: async (
    candidateId: string,
  ): Promise<{ status: string; queue?: QueueState; message?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/candidates/${candidateId}/reject`, {
        method: 'POST',
      });
      return res.json();
    } catch (error) {
      console.error('Reject candidate failed:', error);
      return { status: 'error', message: '网络错误' };
    }
  },

  removeQueueTrack: async (
    index: number,
  ): Promise<{ status: string; queue?: QueueState; message?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/queue/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      return res.json();
    } catch (error) {
      console.error('Remove queue track failed:', error);
      return { status: 'error', message: '网络错误' };
    }
  },

  clearUpcoming: async (): Promise<{ status: string; queue?: QueueState; message?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/queue/clear-upcoming`, {
        method: 'POST',
      });
      return res.json();
    } catch (error) {
      console.error('Clear upcoming failed:', error);
      return { status: 'error', message: '网络错误' };
    }
  },

  moveQueueTrack: async (
    fromIndex: number,
    toIndex: number,
  ): Promise<{ status: string; queue?: QueueState; message?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/queue/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'move', fromIndex, toIndex, source: 'manual' }),
      });
      return res.json();
    } catch (error) {
      console.error('Move queue track failed:', error);
      return { status: 'error', message: '网络错误' };
    }
  },

  selectQueueTrack: async (index: number): Promise<{ status: string; queue?: QueueState; message?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/queue/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      return res.json();
    } catch (error) {
      console.error('Select queue track failed:', error);
      return { status: 'error', message: '网络错误' };
    }
  },

  getPlaylist: async () => {
    try {
      const queue = await api.getQueue();
      return queue.playlist;
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

  getPlayHistory: async (limit = 50, hours = 72): Promise<PlayHistoryItem[]> => {
    try {
      const res = await fetch(`${API_BASE}/api/play-history?limit=${limit}&hours=${hours}`);
      return res.json();
    } catch (error) {
      console.error('Get play history failed:', error);
      return [];
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

let socket: Socket | null = null;
let messageHandler: ((msg: any) => void) | null = null;

export const connectStream = (onMessage: (msg: any) => void, onStatus?: (connected: boolean) => void): Socket | null => {
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

  const events = ['now-playing', 'control', 'chat-stream', 'chat-end', 'playlist-update', 'segue'];
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
