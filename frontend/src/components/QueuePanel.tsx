import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface QueuePanelProps {
  playlist: any[];
  currentIndex: number;
  isPlaying: boolean;
  isQueueOpen: boolean;
  onToggle: () => void;
  onSelect: (index: number) => void;
}

const QueuePanel: React.FC<QueuePanelProps> = React.memo(({
  playlist,
  currentIndex,
  isPlaying,
  isQueueOpen,
  onToggle,
  onSelect,
}) => {
  return (
    <section className="w-full mt-1 transition-colors duration-300 flex-shrink-0">
      <div
        className="flex justify-between items-center mb-sm cursor-pointer group p-1 -mx-1 rounded hover:bg-surface-raised transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-xs">
          <h2 className="text-label text-text-secondary tracking-widest group-hover:text-text-primary transition-colors">QUEUE</h2>
          {isQueueOpen ? <ChevronUp size={14} className="text-text-secondary" /> : <ChevronDown size={14} className="text-text-secondary" />}
        </div>
        <span className="text-label text-text-secondary">{playlist.length} TRACKS</span>
      </div>

      <div className={`grid transition-all duration-300 ease-out ${isQueueOpen ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'}`}>
        <div className="queue-scrollbar flex flex-col overflow-hidden max-h-[220px] overflow-y-auto pr-1">
          {playlist.map((track, i) => (
            <div
              key={track.id}
              onClick={() => { onSelect(i); }}
              className={`flex justify-between py-sm pl-md pr-sm mb-xs transition-colors rounded-r-md cursor-pointer ${
                i === currentIndex
                  ? 'border-l-2 border-success bg-surface-raised/50 text-text-primary font-medium'
                  : 'text-text-disabled hover:bg-surface hover:text-text-secondary border-l-2 border-transparent'
              }`}
            >
              <div className="flex gap-sm text-body-sm items-center truncate">
                <span className={`w-4 flex justify-center text-[10px] ${i === currentIndex && isPlaying ? 'text-success animate-pulse' : ''}`}>
                  {i === currentIndex ? '▶' : i + 1}
                </span>
                <span className="truncate">{track.name}</span>
              </div>
              <span className="text-body-sm text-right truncate max-w-[120px]">{track.artist}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
});

export default QueuePanel;
