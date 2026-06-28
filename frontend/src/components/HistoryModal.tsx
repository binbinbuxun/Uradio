import React, { useEffect, useState } from 'react';
import { Disc3, MessageSquare, Play, Trash2, X } from 'lucide-react';
import { api } from '../api';
import type { ChatSession, PlayHistoryItem, QueueInsertMode } from '../api';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadSession: (sessionId: number) => void;
  onReplayTrack: (track: any, mode?: QueueInsertMode) => void;
  currentSessionId: number | null;
}

const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  onLoadSession,
  onReplayTrack,
  currentSessionId,
}) => {
  const [tab, setTab] = useState<'chat' | 'play'>('play');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [playHistory, setPlayHistory] = useState<PlayHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [_deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTab('play');
    setLoading(true);
    Promise.all([api.getSessions(), api.getPlayHistory(60, 168)])
      .then(([sessionResult, plays]) => {
        if (sessionResult.status === 'success') {
          setSessions(sessionResult.sessions);
        }
        setPlayHistory(plays);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDelete = async (event: React.MouseEvent, sessionId: number) => {
    event.stopPropagation();
    if (!window.confirm('确定删除这个对话？')) return;
    setDeletingId(sessionId);
    await api.deleteSession(sessionId);
    setSessions((prev) => prev.filter((session) => session.id !== sessionId));
    setDeletingId(null);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === now.toDateString()) return '今天';
    if (date.toDateString() === yesterday.toDateString()) return '昨天';
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  const triggerLabel: Record<string, string> = {
    user_request: '用户点播',
    auto_next: '自动切换',
    recommendation: '电台推荐',
    search: '搜索结果',
    chat_play: 'DJ 推荐',
    manual: '手动播放',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-[480px] max-h-[75vh] overflow-hidden rounded-2xl border border-border-visible bg-black"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nd-panel-header border-b-0">
          <span className="text-subheading text-text-display">历史记录</span>
          <button onClick={onClose} className="text-text-disabled transition-colors hover:text-text-display" title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="px-md pb-sm">
          <div className="nd-segmented">
            <button
              onClick={() => setTab('play')}
              className={`nd-segment ${tab === 'play' ? 'nd-segment-active' : ''}`}
            >
              PLAY HISTORY
            </button>
            <button
              onClick={() => setTab('chat')}
              className={`nd-segment ${tab === 'chat' ? 'nd-segment-active' : ''}`}
            >
              CHAT SESSIONS
            </button>
          </div>
        </div>

        <div className="queue-scrollbar flex max-h-[56vh] flex-col gap-2 overflow-y-auto px-md pb-md">
          {loading && (
            <div className="py-lg text-center text-label text-text-disabled">LOADING...</div>
          )}

          {!loading && tab === 'chat' && sessions.length === 0 && (
            <div className="py-lg text-center text-label text-text-disabled">暂无对话记录</div>
          )}

          {!loading && tab === 'chat' && sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => onLoadSession(session.id)}
              className={`nd-track-card cursor-pointer ${session.id === currentSessionId ? 'border-text-display' : ''}`}
            >
              <div className="text-text-disabled">
                <MessageSquare size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-body-sm text-text-primary">{session.title || '新对话'}</div>
                <div className="mt-1 text-caption text-text-secondary">
                  {formatDate(session.updatedAt)} {formatTime(session.updatedAt)}
                  {session.messageCount > 0 ? ` · ${session.messageCount} 条消息` : ''}
                </div>
              </div>
              <button
                onClick={(event) => handleDelete(event, session.id)}
                className="text-text-disabled transition-colors hover:text-error"
                title="删除对话"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          {!loading && tab === 'play' && playHistory.length === 0 && (
            <div className="py-lg text-center text-label text-text-disabled">暂无播放历史</div>
          )}

          {!loading && tab === 'play' && playHistory.map((item) => (
            <div key={item.id} className="nd-track-card">
              <div className="flex-shrink-0 text-text-disabled">
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt="" className="h-10 w-10 rounded-[10px] object-cover" />
                ) : (
                  <Disc3 size={18} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-body-sm text-text-primary">{item.title}</div>
                <div className="truncate text-caption text-text-secondary">{item.artist || '未知歌手'}</div>
                <div className="mt-1 text-caption text-text-disabled">
                  {formatDate(item.playedAt)} {formatTime(item.playedAt)} · {triggerLabel[item.trigger] || item.trigger}
                </div>
              </div>
              <button
                onClick={() => onReplayTrack({
                  id: item.songId,
                  name: item.title,
                  artist: item.artist,
                  cover: item.coverUrl,
                  url: `/audio/${item.songId}`,
                }, 'play_now')}
                className="nd-icon-button"
                title="重新播放"
              >
                <Play size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HistoryModal;
