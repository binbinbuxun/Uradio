import React, { useState } from 'react';
import { ArrowUp, ChevronDown, ChevronUp, History, Play, Plus, StepForward } from 'lucide-react';
import type { QueueInsertMode } from '../api';

interface ChatPanelProps {
  chatMessages: { id: string; role: 'user' | 'dj'; content: string; timestamp: number; recommendedSongs?: any[]; searchResults?: any[] }[];
  isDjTyping: boolean;
  djStreamIdRef: React.MutableRefObject<string | null>;
  chatInput: string;
  playlist: any[];
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClearHistory: () => void;
  onOpenHistory: () => void;
  onAddTrack: (track: any, mode?: QueueInsertMode) => void;
  showComposer?: boolean;
}

const SongCard: React.FC<{
  song: any;
  added: boolean;
  onAddTrack: (song: any, mode?: QueueInsertMode) => void;
}> = React.memo(({ song, added, onAddTrack }) => (
  <div className="nd-track-card">
    {song.cover && (
      <img src={song.cover} alt="" loading="lazy" className="h-10 w-10 rounded-[10px] object-cover shrink-0" />
    )}
    <div className="min-w-0 flex-1">
      <div className="truncate text-body-sm text-text-primary">{song.name}</div>
      <div className="truncate text-caption text-text-secondary">{song.artist}</div>
      {song.reason && (
        <div className="mt-1 line-clamp-2 text-caption text-text-disabled">{song.reason}</div>
      )}
    </div>
    <div className="flex shrink-0 items-center gap-xs">
      {added ? (
        <span className="text-label text-text-disabled">IN QUEUE</span>
      ) : (
        <>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onAddTrack(song, 'play_now');
            }}
            className="nd-icon-button"
            title="Play now"
          >
            <Play size={14} />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onAddTrack(song, 'play_next');
            }}
            className="nd-icon-button"
            title="Play next"
          >
            <StepForward size={14} />
          </button>
        </>
      )}
    </div>
  </div>
));

const ChatPanel: React.FC<ChatPanelProps> = React.memo(({
  chatMessages,
  isDjTyping,
  djStreamIdRef,
  chatInput,
  playlist,
  chatContainerRef,
  onInputChange,
  onSend,
  onClearHistory,
  onOpenHistory,
  onAddTrack,
  showComposer = true,
}) => {
  const [collapsedMsgs, setCollapsedMsgs] = useState<Set<string>>(new Set());

  const isInPlaylist = (songId: string) => playlist.some((track: any) => track.id === songId);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      onSend();
    }
  };

  const toggleCollapse = (msgId: string) => {
    setCollapsedMsgs((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  };

  const dedupeSongs = (songs: any[]) => {
    const seen = new Set<string>();
    return songs.filter((song) => {
      const key = song.candidateId || song.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return (
    <section className="nd-panel transition-colors duration-300">
      <div className="pointer-events-none absolute inset-0 dot-grid-subtle opacity-15" />

      <div className="nd-panel-header">
        <span className="nd-panel-title">PRIVATE DJ</span>
        <div className="flex items-center gap-xs">
          <button onClick={onOpenHistory} className="nd-icon-button" title="History">
            <History size={14} />
          </button>
          <button
            onClick={() => {
              if (window.confirm('Start a new conversation? The current DJ thread will be cleared.')) {
                onClearHistory();
              }
            }}
            className="nd-icon-button"
            title="New conversation"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div ref={chatContainerRef} className="queue-scrollbar relative z-10 flex max-h-[360px] flex-col overflow-y-auto px-md py-sm text-body-sm">
        {chatMessages.length === 0 && !isDjTyping && (
          <div className="py-lg text-center text-text-disabled">
            <span className="text-label tracking-widest">TELL THE DJ WHAT YOU WANT TO HEAR</span>
          </div>
        )}

        {chatMessages.map((msg) => {
          const allSongs = dedupeSongs([...(msg.recommendedSongs || []), ...(msg.searchResults || [])]);
          const hasSongs = msg.role === 'dj' && allSongs.length > 0;
          const collapsed = collapsedMsgs.has(msg.id);
          const canCollapse = allSongs.length > 4;

          return (
            <div key={msg.id} className="group py-1">
              <div className="flex gap-md">
                <span className="w-[44px] shrink-0 pt-0.5 text-right text-label text-text-disabled">
                  {msg.role === 'dj' ? 'DJ' : 'YOU'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={msg.role === 'user' ? 'text-text-secondary' : 'text-text-primary'}>
                    {msg.content}
                    {msg.role === 'dj' && msg.id === djStreamIdRef.current && (
                      <span className="ml-[2px] inline-block h-[13px] w-[6px] align-middle bg-text-primary animate-[cursor-blink_1s_step-end_infinite]" />
                    )}
                  </div>

                  {(msg as any).ttsFailed && (
                    <div className="mt-1 text-caption text-text-disabled">TTS unavailable</div>
                  )}

                  {hasSongs && (
                    <div className="mt-3 flex flex-col gap-2">
                      {msg.searchResults && msg.searchResults.length > 0 && (
                        <div className="text-label text-text-disabled">SEARCH RESULTS</div>
                      )}

                      {canCollapse ? (
                        <>
                          {allSongs.slice(0, 3).map((song: any) => (
                            <SongCard
                              key={song.candidateId || song.id}
                              song={song}
                              added={isInPlaylist(song.id)}
                              onAddTrack={onAddTrack}
                            />
                          ))}
                          <div className={`overflow-hidden transition-all duration-300 ease-out ${collapsed ? 'max-h-0 opacity-0' : 'max-h-[520px] opacity-100'}`}>
                            <div className="flex flex-col gap-2 pt-2">
                              {allSongs.slice(3).map((song: any) => (
                                <SongCard
                                  key={song.candidateId || song.id}
                                  song={song}
                                  added={isInPlaylist(song.id)}
                                  onAddTrack={onAddTrack}
                                />
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={() => toggleCollapse(msg.id)}
                            className="inline-flex items-center gap-1 self-start text-label text-text-disabled transition-colors hover:text-text-display"
                          >
                            {collapsed ? (
                              <>
                                <ChevronDown size={12} />
                                SHOW {allSongs.length - 3} MORE
                              </>
                            ) : (
                              <>
                                <ChevronUp size={12} />
                                COLLAPSE
                              </>
                            )}
                          </button>
                        </>
                      ) : (
                        allSongs.map((song: any) => (
                          <SongCard
                            key={song.candidateId || song.id}
                            song={song}
                            added={isInPlaylist(song.id)}
                            onAddTrack={onAddTrack}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {isDjTyping && !djStreamIdRef.current && (
          <div className="flex gap-md py-1">
            <span className="w-[44px] shrink-0 text-right text-label text-text-disabled">DJ</span>
            <span className="inline-block h-[13px] w-[6px] align-middle bg-text-disabled animate-[cursor-blink_1s_step-end_infinite]" />
          </div>
        )}
      </div>

      {showComposer && (
        <div className="nd-panel-body border-t border-border-visible">
          <div className="nd-input-shell">
            <span className="shrink-0 text-label text-text-disabled">&gt;</span>
            <input
              type="text"
              placeholder="Tell the DJ what you want to hear."
              className="w-full bg-transparent font-body text-body-sm text-text-primary placeholder:text-text-disabled outline-none"
              value={chatInput}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              onClick={onSend}
              disabled={!chatInput.trim()}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                chatInput.trim()
                  ? 'border-text-display text-text-display hover:border-text-secondary hover:text-text-secondary'
                  : 'border-border-visible text-text-disabled'
              }`}
              title="Send"
            >
              <ArrowUp size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
});

export default ChatPanel;
