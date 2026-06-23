import React, { useState } from 'react';
import { ArrowUp, ChevronDown, ChevronUp } from 'lucide-react';

interface ChatPanelProps {
  chatMessages: { id: string; role: 'user' | 'dj'; content: string; timestamp: number; recommendedSongs?: any[]; searchResults?: any[] }[];
  isDjTyping: boolean;
  djStreamIdRef: React.MutableRefObject<string | null>;
  chatInput: string;
  playlist: any[];
  currentIndex: number;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClearHistory: () => void;
  onAddTrack: (track: any) => void;
  onViewHistory: () => void;
}

// Song card sub-component
const SongCard: React.FC<{ song: any; added: boolean; onAddTrack: (song: any) => void }> = React.memo(({ song, added, onAddTrack }) => (
  <div
    onClick={() => { if (!added) onAddTrack(song); }}
    className={`flex items-center gap-md border px-md py-sm rounded-lg transition-colors select-none ${
      added
        ? 'border-border opacity-50 cursor-default'
        : 'border-border-visible cursor-pointer hover:border-text-secondary hover:bg-surface-raised active:scale-[0.99]'
    }`}
  >
    {song.cover && (
      <img src={song.cover} alt="" loading="lazy" className="w-10 h-10 rounded object-cover flex-shrink-0" />
    )}
    <div className="flex flex-col min-w-0 flex-1">
      <span className="text-body text-text-primary truncate">{song.name}</span>
      <span className="text-caption text-text-secondary truncate">{song.artist}</span>
    </div>
    {added ? (
      <span className="text-[10px] text-text-disabled flex-shrink-0 font-mono">ADDED</span>
    ) : (
      <span className="text-[10px] text-interactive flex-shrink-0 font-mono tracking-widest">PLAY</span>
    )}
  </div>
));

const ChatPanel: React.FC<ChatPanelProps> = React.memo(({
  chatMessages,
  isDjTyping,
  djStreamIdRef,
  chatInput,
  playlist,
  currentIndex: _currentIndex,
  chatContainerRef,
  onInputChange,
  onSend,
  onClearHistory,
  onAddTrack,
  onViewHistory,
}) => {
  const [collapsedMsgs, setCollapsedMsgs] = useState<Set<string>>(new Set());
  const isInPlaylist = (songId: string) => playlist.some((t: any) => t.id === songId);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSend();
  };

  const toggleCollapse = (msgId: string) => {
    setCollapsedMsgs(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId); else next.add(msgId);
      return next;
    });
  };

  const dedupeSongs = (songs: any[]) => {
    const seen = new Set<string>();
    return songs.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
  };

  return (
    <section className="w-full mt-auto mb-2 border border-border-visible bg-surface rounded-lg overflow-hidden transition-colors duration-300">
      <div className="absolute inset-0 dot-grid-subtle opacity-20 pointer-events-none"></div>

      {/* Header */}
      <div className="px-md py-sm flex justify-between items-center border-b border-border-visible z-10 relative">
        <span className="text-label text-text-disabled tracking-widest select-none">Private DJ</span>
        <div className="flex items-center gap-sm">
          <button
            onClick={onViewHistory}
            className="text-caption text-text-disabled hover:text-text-secondary transition-colors flex items-center"
            title="查看历史"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <button
            onClick={() => {
              if (window.confirm('确定清空所有对话记录？此操作不可撤销。')) {
                onClearHistory();
              }
            }}
            className="text-caption text-text-disabled hover:text-text-secondary transition-colors flex items-center"
            title="新对话"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={chatContainerRef} className="px-md py-sm z-10 relative flex flex-col max-h-[300px] overflow-y-auto queue-scrollbar font-mono text-body-sm leading-relaxed">
        {chatMessages.length === 0 && !isDjTyping && (
          <div className="text-text-disabled py-lg text-center select-none">
            <span className="text-label tracking-widest">
              Say something to the DJ
            </span>
          </div>
        )}

        {chatMessages.map((msg) => {
          const allSongs = dedupeSongs([...(msg.recommendedSongs || []), ...(msg.searchResults || [])]);
          const hasSongs = msg.role === 'dj' && allSongs.length > 0;
          const collapsed = collapsedMsgs.has(msg.id);
          const canCollapse = allSongs.length > 4;

          return (
            <div key={msg.id} className="group">
              {/* Message line — both roles use same indent structure */}
              <div className="py-1 flex">
                <span className="text-label text-text-disabled mr-md select-none shrink-0 w-[28px] text-right">
                  {msg.role === 'dj' ? 'DJ' : 'YOU'}
                </span>
                <span className={msg.role === 'user' ? 'text-text-secondary' : 'text-text-primary'}>
                  {msg.content}
                  {msg.role === 'dj' && msg.id === djStreamIdRef.current && (
                    <span className="inline-block w-[6px] h-[13px] bg-text-primary ml-[2px] align-middle animate-[cursor-blink_1s_step-end_infinite]" />
                  )}
                </span>
              </div>

              {/* TTS failed */}
              {(msg as any).ttsFailed && (
                <div className="text-caption text-text-disabled pb-1 flex">
                  <span className="text-label text-text-disabled mr-md select-none shrink-0 w-[28px]">&nbsp;</span>
                  TTS unavailable
                </div>
              )}

              {/* Song cards */}
              {hasSongs && (
                <div className="ml-0 mb-sm mt-1 flex flex-col gap-1">
                  {msg.searchResults && msg.searchResults.length > 0 && (
                    <div className="text-[10px] text-text-disabled tracking-widest mb-1 pl-[28px]">RESULTS</div>
                  )}
                  {/* Song cards: show all if ≤4, otherwise first 3 + collapsible */}
                  {canCollapse ? (
                    <>
                      {allSongs.slice(0, 3).map((song: any) => (
                        <SongCard key={song.id} song={song} added={isInPlaylist(song.id)} onAddTrack={onAddTrack} />
                      ))}
                      <div
                        className={`overflow-hidden transition-all duration-300 ease-out flex flex-col gap-1 ${
                          collapsed ? 'max-h-0 opacity-0' : 'max-h-[500px] opacity-100'
                        }`}
                      >
                        {allSongs.slice(3).map((song: any) => (
                          <SongCard key={song.id} song={song} added={isInPlaylist(song.id)} onAddTrack={onAddTrack} />
                        ))}
                      </div>
                      <button
                        onClick={() => toggleCollapse(msg.id)}
                        className="text-caption text-text-disabled hover:text-text-secondary transition-colors self-start flex items-center gap-1"
                      >
                        {collapsed ? (
                          <><ChevronDown size={10} /> Show {allSongs.length - 3} more</>
                        ) : (
                          <><ChevronUp size={10} /> Show less</>
                        )}
                      </button>
                    </>
                  ) : (
                    allSongs.map((song: any) => (
                      <SongCard key={song.id} song={song} added={isInPlaylist(song.id)} onAddTrack={onAddTrack} />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Typing */}
        {isDjTyping && !djStreamIdRef.current && (
          <div className="py-1 flex">
            <span className="text-label text-text-disabled mr-md select-none shrink-0 w-[28px] text-right">DJ</span>
            <span className="inline-block w-[6px] h-[13px] bg-text-disabled align-middle animate-[cursor-blink_1s_step-end_infinite]" />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="px-md py-sm border-t border-border-visible z-10 relative flex gap-sm items-center">
        <span className="text-label text-text-disabled tracking-widest select-none shrink-0">&gt;</span>
        <input
          type="text"
          placeholder="Type a message..."
          className="bg-transparent border-none outline-none w-full text-text-primary placeholder-text-disabled text-body-sm font-mono"
          value={chatInput}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          onClick={onSend}
          disabled={!chatInput.trim()}
          className={`shrink-0 w-8 h-8 border flex items-center justify-center transition-all ${
            chatInput.trim()
              ? 'border-interactive text-interactive shadow-[0_0_12px_-4px_var(--interactive)] hover:opacity-90 cursor-pointer active:scale-90'
              : 'border-border-visible text-text-disabled cursor-not-allowed'
          }`}
        >
          <ArrowUp size={14} strokeWidth={2} />
        </button>
      </div>
    </section>
  );
});

export default ChatPanel;





