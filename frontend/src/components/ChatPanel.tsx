import React from 'react';
import { Mic, ArrowUp } from 'lucide-react';

interface ChatPanelProps {
  chatMessages: { id: string; role: 'user' | 'dj'; content: string; timestamp: number; recommendedSongs?: any[]; searchResults?: any[] }[];
  isDjTyping: boolean;
  djStreamIdRef: React.MutableRefObject<string | null>;
  chatInput: string;
  playlist: any[];
  currentIndex: number;
  historyLoaded: boolean;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClearHistory: () => void;
  onAddTrack: (track: any) => void;
}

const ChatPanel: React.FC<ChatPanelProps> = React.memo(({
  chatMessages,
  isDjTyping,
  djStreamIdRef,
  chatInput,
  playlist,
  currentIndex,
  historyLoaded,
  chatContainerRef,
  onInputChange,
  onSend,
  onClearHistory,
  onAddTrack,
}) => {
  const isInPlaylist = (songId: string) => playlist.some((t: any) => t.id === songId);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSend();
  };

  return (
    <section className="w-full mt-auto mb-2 border border-border-visible bg-surface rounded-xl overflow-hidden relative transition-colors duration-300">
      <div className="absolute inset-0 dot-grid-subtle opacity-30 pointer-events-none"></div>

      <div className="p-sm flex justify-between items-center border-b border-border-visible z-10 relative bg-surface/50 backdrop-blur-sm">
        <div className="flex items-center gap-xs">
          <div className="w-4 h-4 rounded-full border border-success flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse"></div>
          </div>
          <span className="text-subheading text-text-display font-medium tracking-tight">DJ</span>
        </div>
        <span className="text-label text-success tracking-widest opacity-80">LIVE DJ</span>
      </div>

      <div className="p-md z-10 relative flex flex-col gap-md">
        <div ref={chatContainerRef} className="flex flex-col gap-sm max-h-[300px] overflow-y-auto queue-scrollbar">
          {historyLoaded && (
            <div className="flex items-center justify-between px-sm py-xs text-caption text-text-disabled border-b border-border-visible pb-xs mb-xs">
              <span>Loaded {chatMessages.length} message{chatMessages.length > 1 ? 's' : ''} from history</span>
              <div className="flex gap-sm">
                <button
                  onClick={onClearHistory}
                  className="text-text-disabled hover:text-text-secondary transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          {chatMessages.length === 0 && !isDjTyping && (
            <div className="text-center text-text-disabled text-label py-md">
              Say something to the DJ...
            </div>
          )}

          {chatMessages.map((msg) => (
            <div key={msg.id}>
              <div
                className={`flex gap-sm ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'dj' && (
                  <div className="w-8 h-8 rounded-full bg-surface-raised border border-border flex-shrink-0 flex items-center justify-center">
                    <Mic size={14} className="text-text-secondary" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-md py-sm ${
                    msg.role === 'user'
                      ? 'bg-interactive text-black rounded-br-none'
                      : 'bg-surface-raised border border-border-visible rounded-bl-none'
                  }`}
                >
                  {msg.role === 'dj' && (
                    <div className="text-label text-text-secondary mb-1">DJ</div>
                  )}
                  <p className={`text-body-sm leading-relaxed ${msg.role === 'user' ? 'text-black' : 'text-text-primary'}`}>
                    {msg.content}
                  </p>
                </div>
                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-surface-raised border border-border flex-shrink-0 flex items-center justify-center">
                    <span className="text-label text-text-primary">U</span>
                  </div>
                )}
              </div>

              {/* Recommended songs */}
              {msg.role === 'dj' && msg.recommendedSongs && msg.recommendedSongs.length > 0 && (
                <div className="flex gap-sm mt-1">
                  <div className="w-8 flex-shrink-0" />
                  <div className="flex flex-col gap-2 max-w-[80%]">
                    {msg.recommendedSongs.map((song: any) => {
                      const added = isInPlaylist(song.id);
                      return (
                        <div
                          key={song.id}
                          onClick={() => { if (!added) onAddTrack(song); }}
                          className={`flex items-center gap-md bg-surface border rounded-xl px-md py-sm transition-all active:scale-95 ${
                            added
                              ? 'border-success/30 opacity-60 cursor-default'
                              : 'border-border-visible cursor-pointer hover:border-interactive hover:bg-surface-raised'
                          }`}
                        >
                          {song.cover && (
                            <img src={song.cover} alt="" loading="lazy" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                          )}
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-body text-text-primary truncate">{song.name}</span>
                            <span className="text-label-normal text-text-secondary truncate">{song.artist}</span>
                          </div>
                          {added && (
                            <span className="text-[10px] text-success flex-shrink-0">已添加</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Search results */}
              {msg.role === 'dj' && msg.searchResults && msg.searchResults.length > 0 && (
                <div className="flex gap-sm mt-1">
                  <div className="w-8 flex-shrink-0" />
                  <div className="flex flex-col gap-2 max-w-[80%]">
                    <div className="text-label text-text-secondary">选择一首播放</div>
                    {msg.searchResults.map((song: any) => {
                      const added = isInPlaylist(song.id);
                      return (
                        <div
                          key={song.id}
                          onClick={() => { if (!added) onAddTrack(song); }}
                          className={`flex items-center gap-md bg-surface border rounded-xl px-md py-sm transition-all active:scale-95 ${
                            added
                              ? 'border-success/30 opacity-60 cursor-default'
                              : 'border-border-visible cursor-pointer hover:border-interactive hover:bg-surface-raised'
                          }`}
                        >
                          {song.cover && (
                            <img src={song.cover} alt="" loading="lazy" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                          )}
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-body text-text-primary truncate">{song.name}</span>
                            <span className="text-label-normal text-text-secondary truncate">{song.artist}</span>
                          </div>
                          {added ? (
                            <span className="text-[10px] text-success flex-shrink-0">已添加</span>
                          ) : (
                            <span className="text-label text-interactive flex-shrink-0">播放</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* DJ Typing Indicator */}
          {isDjTyping && !djStreamIdRef.current && (
            <div className="flex gap-sm justify-start">
              <div className="w-8 h-8 rounded-full bg-surface-raised border border-border flex-shrink-0 flex items-center justify-center">
                <Mic size={14} className="text-text-secondary" />
              </div>
              <div className="bg-surface-raised border border-border-visible rounded-2xl rounded-bl-none px-md py-sm">
                <div className="text-label text-text-secondary mb-1">DJ</div>
                <div className="flex gap-1 items-center py-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-text-secondary animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-text-secondary animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-text-secondary animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-sm mt-md items-center w-full">
          <div className="flex-1 bg-black border border-border-visible rounded-full px-lg py-sm flex items-center focus-within:border-interactive transition-colors">
            <input
              type="text"
              placeholder="Say something to the DJ..."
              className="bg-transparent border-none outline-none w-full text-text-primary placeholder-text-disabled text-body-sm"
              value={chatInput}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          <button className="w-10 h-10 rounded-full border border-border-visible flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-all cursor-pointer active:scale-95 flex-shrink-0 group">
            <Mic size={18} strokeWidth={1.5} className="group-hover:scale-110 transition-transform" />
          </button>
          <button
            onClick={onSend}
            className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all cursor-pointer active:scale-95 flex-shrink-0 ${
              chatInput.trim()
                ? 'border-interactive bg-interactive text-black hover:opacity-90'
                : 'border-border-visible text-text-disabled bg-surface-raised cursor-not-allowed'
            }`}
          >
            <ArrowUp size={18} strokeWidth={2} />
          </button>
        </div>
      </div>
    </section>
  );
});

export default ChatPanel;
