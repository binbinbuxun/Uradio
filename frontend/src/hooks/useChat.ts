import { useState, useEffect, useRef } from 'react';
import { api, connectStream } from '../api';

interface ChatState {
  chatMessages: { id: string; role: 'user' | 'dj'; content: string; timestamp: number; recommendedSongs?: any[]; searchResults?: any[] }[];
  chatInput: string;
  isDjTyping: boolean;
  wsConnected: boolean;
  isHistoryOpen: boolean;
  currentSessionId: number | null;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  djStreamIdRef: React.MutableRefObject<string | null>;
  setChatInput: React.Dispatch<React.SetStateAction<string>>;
  setIsHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentSessionId: React.Dispatch<React.SetStateAction<number | null>>;
  handleSendMessage: () => Promise<void>;
  handleClearHistory: () => Promise<void>;
  handleLoadSession: (sessionId: number) => Promise<void>;
  handleAddTrack: (song: any) => void;
  handleQueueSelect: (index: number) => void;
}

export function useChat(
  volume: number,
  gainNodeRef: React.RefObject<GainNode | null>,
  isFadingRef: React.RefObject<boolean>,
  ttsChunksRef: React.RefObject<Map<number, string[]>>,
  ttsAudioRef: React.RefObject<HTMLAudioElement | null>,
  playlist: any[],
  currentIndex: number,
  setPlaylist: React.Dispatch<React.SetStateAction<any[]>>,
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>,
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>,
  crossfadeNext: () => void,
  crossfadePrev: () => void,
  setErrorToast: (msg: string | null) => void,
): ChatState {
  const [chatMessages, setChatMessages] = useState<{ id: string; role: 'user' | 'dj'; content: string; timestamp: number; recommendedSongs?: any[]; searchResults?: any[] }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isDjTyping, setIsDjTyping] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);

  const djStreamIdRef = useRef<string | null>(null);
  const djStreamChatIdRef = useRef<string | null>(null); // 用于 done 后仍能匹配 recommendedSongs
  const msgCounter = useRef(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const djStreamClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipHistoryLoadRef = useRef(false); // 新建对话时跳过自动加载

  // Auto-scroll chat
  useEffect(() => {
    chatContainerRef.current?.scrollTo({
      top: chatContainerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [chatMessages, isDjTyping]);

  // Load chat history on mount (or when session changes)
  useEffect(() => {
    if (skipHistoryLoadRef.current) {
      skipHistoryLoadRef.current = false;
      return;
    }
    if (currentSessionId) {
      // 按会话加载
      api.getSessionMessages(currentSessionId).then((result) => {
        if (result.status === 'success' && result.messages) {
          setChatMessages(result.messages);
        }
      }).catch(console.error);
    } else {
      // 加载最近消息
      api.getChatHistory(50).then((history) => {
        if (history.length > 0) {
          setChatMessages(history);
        }
      }).catch(console.error);
    }
  }, [currentSessionId]);

  // DJ reply timeout guard (20s)
  useEffect(() => {
    if (!isDjTyping) return;
    const timeout = setTimeout(() => {
      setIsDjTyping(false);
      djStreamIdRef.current = null;
      djStreamChatIdRef.current = null;
      if (djStreamClearTimerRef.current) {
        clearTimeout(djStreamClearTimerRef.current);
        djStreamClearTimerRef.current = null;
      }
      setErrorToast('DJ 信号丢失，稍后再试');
      setTimeout(() => setErrorToast(null), 3000);
    }, 20000);
    return () => clearTimeout(timeout);
  }, [isDjTyping, setErrorToast]);

  // WebSocket
  useEffect(() => {
    const ws = connectStream((msg) => {
      if (msg.type === 'chat-stream') {
        const payload = msg.data?.data || msg.data;
        const binary = msg.binary as ArrayBuffer | undefined;
        const { delta, done, metadata } = payload;

        if (delta && !djStreamIdRef.current) {
          msgCounter.current++;
          const newId = `dj_${msgCounter.current}`;
          djStreamIdRef.current = newId;
          djStreamChatIdRef.current = metadata?.chatId || null;
          ttsChunksRef.current = new Map();
          setIsDjTyping(true);
          setChatMessages((msgs) => [
            ...msgs,
            { id: newId, role: 'dj', content: delta, timestamp: Date.now(), chatId: metadata?.chatId },
          ]);
          return;
        }

        if (delta && djStreamIdRef.current) {
          setChatMessages((msgs) => {
            const idx = msgs.findIndex((m) => m.id === djStreamIdRef.current);
            if (idx >= 0) {
              const updated = [...msgs];
              updated[idx] = { ...updated[idx], content: updated[idx].content + delta };
              return updated;
            }
            return msgs;
          });
        }

        // TTS audio chunks
        if (metadata?.ttsChunk || metadata?.ttsBinary) {
          const si = metadata.sentenceIndex ?? 0;
          if (!ttsChunksRef.current.has(si)) {
            ttsChunksRef.current.set(si, []);
          }
          if (metadata.ttsBinary && binary) {
            const bytes = new Uint8Array(binary);
            let binStr = '';
            for (let i = 0; i < bytes.length; i++) {
              binStr += String.fromCharCode(bytes[i]);
            }
            ttsChunksRef.current.get(si)!.push(btoa(binStr));
          } else if (metadata.ttsChunk) {
            ttsChunksRef.current.get(si)!.push(metadata.ttsChunk);
          }
        }

        if (metadata?.ttsDone) {
          if (ttsAudioRef.current) {
            ttsAudioRef.current.pause();
            ttsAudioRef.current = null;
          }

          if (metadata.ttsFailed) {
            setChatMessages((msgs) => {
              const idx = msgs.findIndex((m) => m.id === djStreamIdRef.current);
              if (idx >= 0) {
                const updated = [...msgs];
                updated[idx] = { ...updated[idx], ttsFailed: true };
                return updated;
              }
              return msgs;
            });
          }

          const sentenceMap = ttsChunksRef.current;
          ttsChunksRef.current = new Map();
          if (sentenceMap.size === 0) return;

          const orderedIndices = Array.from(sentenceMap.keys()).sort((a, b) => a - b);
          const orderedChunks: string[] = [];
          for (const si of orderedIndices) {
            orderedChunks.push(...sentenceMap.get(si)!);
          }
          if (orderedChunks.length === 0) return;

          const gainNode = gainNodeRef.current;
          const currentVol = volume;
          if (gainNode) gainNode.gain.value = currentVol * currentVol * 0.2;

          try {
            const totalLength = orderedChunks.reduce((sum, c) => sum + atob(c).length, 0);
            const arr = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of orderedChunks) {
              const raw = atob(chunk);
              for (let i = 0; i < raw.length; i++) arr[offset++] = raw.charCodeAt(i);
            }
            const blob = new Blob([arr], { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            const ttsAudio = new Audio(url);
            ttsAudioRef.current = ttsAudio;

            ttsAudio.onended = () => {
              if (gainNode) gainNode.gain.value = currentVol * currentVol;
              URL.revokeObjectURL(url);
              ttsAudioRef.current = null;
            };
            ttsAudio.onerror = () => {
              if (gainNode) gainNode.gain.value = currentVol * currentVol;
              URL.revokeObjectURL(url);
              ttsAudioRef.current = null;
            };
            ttsAudio.play().catch(() => {
              if (gainNode) gainNode.gain.value = currentVol * currentVol;
              URL.revokeObjectURL(url);
              ttsAudioRef.current = null;
            });
          } catch {
            if (gainNode) gainNode.gain.value = currentVol * currentVol;
          }
        }

        if (metadata?.recommendedSongs) {
          const songs = metadata.recommendedSongs;
          // 匹配优先级: djStreamIdRef（流进行中） > djStreamChatIdRef（流刚结束）
          const targetId = djStreamIdRef.current || djStreamChatIdRef.current;
          const targetChatId = metadata.chatId;
          setChatMessages((msgs) => {
            // 先按 streamId 匹配
            let idx = targetId
              ? msgs.findIndex((m) => m.id === targetId)
              : -1;
            // 再按 chatId 匹配
            if (idx < 0 && targetChatId) {
              idx = msgs.findIndex((m) => (m as any).chatId === targetChatId);
            }
            if (idx >= 0) {
              const updated = [...msgs];
              updated[idx] = { ...updated[idx], recommendedSongs: songs };
              return updated;
            }
            return msgs;
          });
        }

        if (metadata?.searchResults) {
          const songs = metadata.searchResults;
          const targetId = djStreamIdRef.current || djStreamChatIdRef.current;
          const targetChatId = metadata.chatId;
          setChatMessages((msgs) => {
            let idx = targetId
              ? msgs.findIndex((m) => m.id === targetId)
              : -1;
            if (idx < 0 && targetChatId) {
              idx = msgs.findIndex((m) => (m as any).chatId === targetChatId);
            }
            if (idx >= 0) {
              const updated = [...msgs];
              updated[idx] = { ...updated[idx], searchResults: songs };
              return updated;
            }
            return msgs;
          });
        }

        if (done) {
          // 延迟清空，等待 recommendedSongs/searchResults 到达（最多等 2 秒）
          if (djStreamClearTimerRef.current) clearTimeout(djStreamClearTimerRef.current);
          djStreamClearTimerRef.current = setTimeout(() => {
            djStreamIdRef.current = null;
            djStreamChatIdRef.current = null;
          }, 2000);
          setIsDjTyping(false);
        }
      }

      if (msg.type === 'chat-end') {
        // 延迟清空，与 done 一致，等待 recommendedSongs/searchResults 到达
        if (djStreamClearTimerRef.current) clearTimeout(djStreamClearTimerRef.current);
        djStreamClearTimerRef.current = setTimeout(() => {
          djStreamIdRef.current = null;
          djStreamChatIdRef.current = null;
        }, 2000);
        setIsDjTyping(false);
      }

      if (msg.type === 'control') {
        const payload = msg.data?.data || msg.data;
        const { command, payload: cmdPayload } = payload;

        switch (command) {
          case 'next':
            crossfadeNext();
            break;
          case 'prev':
            crossfadePrev();
            break;
          case 'pause':
            setIsPlaying(false);
            break;
          case 'play':
            setIsPlaying(true);
            break;
          case 'volume':
            if (cmdPayload?.volume !== undefined) {
              // Can't call setVolume directly from here, needs parent
            }
            break;
        }
      }

      if (msg.type === 'playlist-update') {
        const payload = msg.data?.data || msg.data;
        const { action, songs, playlist: newPlaylist } = payload;

        const mapTrack = (item: any) => ({
          ...item,
          name: item.name || item.title || '',
          url: item.url?.startsWith('http') ? item.url : `http://localhost:3000${item.url}`,
        });

        if (action === 'replace' && newPlaylist) {
          setPlaylist(newPlaylist.map(mapTrack));
        } else if (action === 'add' && songs) {
          setPlaylist(prev => {
            const updated = [...prev];
            const insertAt = currentIndex + 1;
            updated.splice(insertAt, 0, ...songs.map(mapTrack));
            return updated;
          });
        } else if (action === 'remove' && newPlaylist) {
          setPlaylist(newPlaylist.map(mapTrack));
        }
      }
    }, setWsConnected);

    return () => {
      if (ws) ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSendMessage = async () => {
    const message = chatInput.trim();
    if (!message) return;

    djStreamIdRef.current = null;
    djStreamChatIdRef.current = null;
    if (djStreamClearTimerRef.current) {
      clearTimeout(djStreamClearTimerRef.current);
      djStreamClearTimerRef.current = null;
    }

    msgCounter.current++;
    const userMessage = {
      id: `user_${msgCounter.current}`,
      role: 'user' as const,
      content: message,
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput('');
    setIsDjTyping(true);

    try {
      const result = await api.postChat(message, volume, currentSessionId);
      if (result.status === 'error') {
        throw new Error(result.message || 'Chat failed');
      }
      // 保存后端返回的 sessionId（如果是新创建的会话）
      // 跳过重新加载，因为本地已有最新消息
      if (result.sessionId && !currentSessionId) {
        skipHistoryLoadRef.current = true;
        setCurrentSessionId(result.sessionId);
      }
    } catch (error: any) {
      console.error('Send message failed:', error);
      const msg = error?.message === '请求超时' ? 'DJ 信号丢失，稍后再试' : 'DJ 断线了，稍后再试';
      setErrorToast(msg);
      setTimeout(() => setErrorToast(null), 3000);
      setIsDjTyping(false);
    }
  };

  const handleClearHistory = async () => {
    // 新建对话：清空当前消息和 sessionId，跳过自动加载
    skipHistoryLoadRef.current = true;
    setChatMessages([]);
    setCurrentSessionId(null);
  };

  const handleLoadSession = async (sessionId: number) => {
    // 加载某个会话的消息
    setCurrentSessionId(sessionId);
    setIsHistoryOpen(false);
  };

  const handleAddTrack = (song: any) => {
    const newTrack = {
      id: song.id,
      name: song.name,
      artist: song.artist,
      cover: song.cover,
      url: song.url?.startsWith('http') ? song.url : `http://localhost:3000${song.url}`,
    };
    setPlaylist(prev => {
      const nextIndex = currentIndex + 1;
      const updated = [...prev];
      updated.splice(nextIndex, 0, newTrack);
      return updated;
    });
    setCurrentIndex(prev => prev + 1);
    setIsPlaying(true);
  };

  const handleQueueSelect = (index: number) => {
    setCurrentIndex(index);
    setIsPlaying(true);
  };

  return {
    chatMessages,
    chatInput,
    isDjTyping,
    wsConnected,
    isHistoryOpen,
    currentSessionId,
    chatContainerRef,
    djStreamIdRef,
    setChatInput,
    setIsHistoryOpen,
    setCurrentSessionId,
    handleSendMessage,
    handleClearHistory,
    handleLoadSession,
    handleAddTrack,
    handleQueueSelect,
  };
}
