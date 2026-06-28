import React, { useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Play, StepForward, X } from 'lucide-react';
import type { QueueInsertMode, QueueState } from '../api';

interface QueuePanelProps {
  queueState: QueueState;
  isPlaying: boolean;
  isQueueOpen: boolean;
  onToggle: () => void;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onClearUpcoming: () => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onCandidateAction: (song: any, mode?: QueueInsertMode) => void;
  onRejectCandidate: (candidateId: string) => void;
}

const QueuePanel: React.FC<QueuePanelProps> = React.memo(({
  queueState,
  isPlaying,
  isQueueOpen,
  onToggle,
  onSelect,
  onRemove,
  onClearUpcoming,
  onMove,
  onCandidateAction,
  onRejectCandidate,
}) => {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const playlist = queueState.playlist || [];
  const currentIndex = queueState.currentIndex || 0;
  const currentTrack = playlist[currentIndex];
  const upcoming = playlist.slice(currentIndex + 1);
  const candidateGroups = [
    { key: 'chat', label: 'DJ PICKS', items: queueState.candidates?.chat || [] },
    { key: 'radio', label: 'RADIO POOL', items: queueState.candidates?.radio || [] },
  ].filter((group) => group.items.length > 0);

  const startDrag = (absoluteIndex: number) => {
    setDraggingIndex(absoluteIndex);
  };

  const finishDrag = () => {
    setDraggingIndex(null);
    setDragOverIndex(null);
  };

  return (
    <section className="nd-panel w-full transition-colors duration-300">
      <div className="nd-panel-header group cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-xs">
          <h2 className="text-label text-text-secondary transition-colors group-hover:text-text-display">QUEUE</h2>
          {isQueueOpen ? <ChevronUp size={14} className="text-text-secondary" /> : <ChevronDown size={14} className="text-text-secondary" />}
        </div>
        <span className="text-label text-text-secondary">{playlist.length} TRACKS</span>
      </div>

      <div className={`grid transition-all duration-300 ease-out ${isQueueOpen ? 'mt-2 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
        <div className="queue-scrollbar flex max-h-[420px] flex-col gap-sm overflow-y-auto px-md pb-md">
          <div className="nd-card">
            <div className="mb-2 text-label text-text-disabled">NOW PLAYING</div>
            {currentTrack ? (
              <button onClick={() => onSelect(currentIndex)} className="flex w-full items-center justify-between text-left">
                <div className="min-w-0">
                  <div className="truncate text-subheading text-text-display">{currentTrack.name}</div>
                  <div className="truncate text-caption text-text-secondary">{currentTrack.artist}</div>
                </div>
                <span className={`text-label ${isPlaying ? 'text-accent' : 'text-text-disabled'}`}>LIVE</span>
              </button>
            ) : (
              <div className="text-caption text-text-disabled">No track is currently active.</div>
            )}
          </div>

          <div className="nd-card">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-label text-text-disabled">UP NEXT</div>
              {upcoming.length > 0 && (
                <button onClick={onClearUpcoming} className="nd-text-button">
                  CLEAR
                </button>
              )}
            </div>

            {upcoming.length === 0 ? (
              <div className="text-caption text-text-disabled">No upcoming tracks.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {upcoming.map((track, offset) => {
                  const absoluteIndex = currentIndex + 1 + offset;
                  const isDropTarget = dragOverIndex === absoluteIndex;

                  return (
                    <div
                      key={track.queueItemId || `${track.id}_${absoluteIndex}`}
                      draggable
                      onDragStart={() => startDrag(absoluteIndex)}
                      onDragEnd={finishDrag}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOverIndex(absoluteIndex);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggingIndex !== null && draggingIndex !== absoluteIndex) {
                          onMove(draggingIndex, absoluteIndex);
                        }
                        finishDrag();
                      }}
                      className={`nd-track-card ${isDropTarget ? 'border-text-display bg-surface-raised' : ''} ${draggingIndex === absoluteIndex ? 'opacity-50' : ''}`}
                    >
                      <button onClick={() => onSelect(absoluteIndex)} className="min-w-0 flex-1 text-left">
                        <div className="truncate text-body-sm text-text-primary">{track.name}</div>
                        <div className="truncate text-caption text-text-secondary">{track.artist}</div>
                      </button>
                      <GripVertical size={14} className="shrink-0 cursor-grab text-text-disabled" />
                      <button onClick={() => onRemove(absoluteIndex)} className="text-label text-error transition-colors hover:opacity-80">
                        REMOVE
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {candidateGroups.length === 0 && (
            <div className="nd-card-muted">
              <div className="mb-2 text-label text-text-disabled">CANDIDATES</div>
              <div className="text-caption text-text-disabled">No pending recommendations.</div>
            </div>
          )}

          {candidateGroups.map((group) => (
            <div key={group.key} className="nd-card">
              <div className="mb-2 text-label text-text-disabled">{group.label}</div>
              <div className="flex flex-col gap-2">
                {group.items.map((song) => (
                  <div key={song.candidateId} className="nd-track-card">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body-sm text-text-primary">{song.name}</div>
                      <div className="truncate text-caption text-text-secondary">{song.artist}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-xs">
                      <button
                        onClick={() => onCandidateAction(song, 'play_now')}
                        className="nd-icon-button"
                        title="Play now"
                      >
                        <Play size={14} />
                      </button>
                      <button
                        onClick={() => onCandidateAction(song, 'play_next')}
                        className="nd-icon-button"
                        title="Play next"
                      >
                        <StepForward size={14} />
                      </button>
                      <button
                        onClick={() => onRejectCandidate(song.candidateId)}
                        className="nd-icon-button-danger"
                        title="Reject"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
});

export default QueuePanel;
