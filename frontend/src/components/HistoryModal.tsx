import React, { useState, useEffect } from 'react';
import { X, MessageSquare, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { ChatSession } from '../api';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadSession: (sessionId: number) => void;
  currentSessionId: number | null;
}

const HistoryModal: React.FC<HistoryModalProps> = ({ isOpen, onClose, onLoadSession, currentSessionId }) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    api.getSessions().then((result) => {
      if (result.status === 'success') {
        setSessions(result.sessions);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDelete = async (e: React.MouseEvent, sessionId: number) => {
    e.stopPropagation();
    if (!window.confirm('确定删除这个对话？')) return;
    setDeletingId(sessionId);
    await api.deleteSession(sessionId);
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setDeletingId(null);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    if (isToday) return '今天';
    if (isYesterday) return '昨天';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-black border border-border-visible rounded-2xl w-full max-w-[400px] max-h-[70vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-lg py-md flex justify-between items-center border-b border-border-visible flex-shrink-0">
          <span className="text-body text-text-primary font-medium">历史对话</span>
          <button onClick={onClose} className="text-text-disabled hover:text-text-secondary transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-md py-sm queue-scrollbar">
          {loading && (
            <div className="text-text-disabled text-center py-lg text-label">Loading...</div>
          )}
          {!loading && sessions.length === 0 && (
            <div className="text-text-disabled text-center py-lg text-label">暂无对话记录</div>
          )}
          {!loading && sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => onLoadSession(session.id)}
              className={`flex items-center gap-md px-md py-sm rounded-lg cursor-pointer transition-colors group ${
                session.id === currentSessionId
                  ? 'bg-interactive/10 border border-interactive/30'
                  : 'hover:bg-surface-secondary border border-transparent'
              }`}
            >
              <div className="flex-shrink-0 text-text-disabled group-hover:text-text-secondary transition-colors">
                <MessageSquare size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-text-primary text-sm truncate">
                  {session.title || '新对话'}
                </div>
                <div className="text-text-disabled text-[10px] mt-0.5">
                  {formatDate(session.updatedAt)} {formatTime(session.updatedAt)}
                  {session.messageCount > 0 && ` · ${session.messageCount} 条消息`}
                </div>
              </div>
              <button
                onClick={(e) => handleDelete(e, session.id)}
                className="text-text-disabled hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 p-xs cursor-pointer"
                title="删除对话"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HistoryModal;
