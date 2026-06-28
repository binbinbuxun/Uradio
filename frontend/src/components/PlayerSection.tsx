import React, { useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { RadioMode } from '../api';
import { formatTime } from '../utils';

interface PlayerSectionProps {
  currentSong: any;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  audioProgress: { current: number; duration: number };
  radioMode: RadioMode;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onVolumeChange: (v: number) => void;
  onRadioModeChange: (mode: RadioMode) => void;
  onSeekChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSeekStart: () => void;
  onSeekEnd: () => void;
}

const RADIO_MODE_OPTIONS: Array<{ value: RadioMode; label: string }> = [
  { value: 'manual', label: 'MANUAL' },
  { value: 'auto', label: 'AUTO' },
];

const PlayerSection: React.FC<PlayerSectionProps> = React.memo(({
  currentSong,
  isPlaying,
  isLoading,
  volume,
  audioProgress,
  radioMode,
  onPlayPause,
  onPrev,
  onNext,
  onVolumeChange,
  onRadioModeChange,
  onSeekChange,
  onSeekStart,
  onSeekEnd,
}) => {
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const [isVolumeDragging, setIsVolumeDragging] = useState(false);
  const prevVolumeRef = useRef(0.3);

  const progressPct = audioProgress.duration > 0
    ? (audioProgress.current / audioProgress.duration) * 100
    : 0;
  const segmentCount = 28;
  const filledSegmentCount = Math.max(
    0,
    Math.min(segmentCount, Math.round((progressPct / 100) * segmentCount)),
  );

  return (
    <section className="nd-panel transition-colors duration-300">
      <div className="nd-panel-header">
        <span className="nd-panel-title">NOW PLAYING</span>
        <div className="nd-segmented">
          {RADIO_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => onRadioModeChange(option.value)}
              className={`nd-segment ${radioMode === option.value ? 'nd-segment-active' : ''}`}
              title={option.label}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        {isVolumeOpen && (
          <div
            className="fixed inset-0 z-10"
            onClick={() => {
              setIsVolumeOpen(false);
              setIsVolumeDragging(false);
            }}
          />
        )}

        <div className="nd-panel-body flex flex-col gap-lg">
          <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="flex min-w-0 items-start gap-md">
              <div className="mt-1 flex h-10 items-end gap-1 transition-all duration-300">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-4 w-1.5 bg-text-secondary animate-loading-sweep"
                      style={{ animationDelay: `${index * 0.12}s`, height: `${18 + index * 4}px` }}
                    />
                  ))
                ) : isPlaying ? (
                  <>
                    <div className="h-4 w-1.5 bg-text-display animate-[pulse_1s_ease-in-out_infinite]" />
                    <div className="h-8 w-1.5 bg-text-display animate-[pulse_1.2s_ease-in-out_infinite]" />
                    <div className="h-6 w-1.5 bg-text-display animate-[pulse_0.8s_ease-in-out_infinite]" />
                    <div className="h-10 w-1.5 bg-text-display animate-[pulse_1.5s_ease-in-out_infinite]" />
                    <div className="h-3 w-1.5 bg-text-display animate-[pulse_1.1s_ease-in-out_infinite]" />
                  </>
                ) : (
                  <>
                    <div className="h-1 w-1.5 bg-text-disabled opacity-50" />
                    <div className="h-1 w-1.5 bg-text-disabled opacity-50" />
                    <div className="h-1 w-1.5 bg-text-disabled opacity-50" />
                    <div className="h-1 w-1.5 bg-text-disabled opacity-50" />
                    <div className="h-1 w-1.5 bg-text-disabled opacity-50" />
                  </>
                )}
              </div>

              <div key={currentSong?.id ?? 'no-song'} className="track-swap min-w-0">
                <div className="text-label text-text-disabled">ACTIVE TRACK</div>
                <div className="mt-sm truncate text-[clamp(1.75rem,3vw,2.5rem)] font-body leading-[1.05] tracking-[-0.02em] text-text-display">
                  {currentSong ? currentSong.name : 'Waiting for playback'}
                </div>
                <div className="mt-sm truncate text-body-sm text-text-secondary">
                  {currentSong ? currentSong.artist : 'Queue will populate after playlist bootstrap.'}
                </div>
                <div className="mt-md flex flex-wrap items-center gap-sm">
                  <span className="text-label text-text-disabled">
                    {isLoading ? '[BUFFERING]' : isPlaying ? '[LIVE]' : '[PAUSED]'}
                  </span>
                  <span className="text-label text-text-secondary">
                    VOLUME {Math.round(volume * 100)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-start gap-sm lg:items-end">
              <button
                onClick={() => setIsVolumeOpen((prev) => !prev)}
                title="Volume"
                className="nd-ghost-button"
              >
                VOL {Math.round(volume * 100)}
              </button>

              <div className={`absolute right-md top-[4.75rem] z-20 transition-all duration-200 ease-out ${isVolumeOpen ? 'translate-y-0 opacity-100 pointer-events-auto' : '-translate-y-1 opacity-0 pointer-events-none'}`}>
                <div className="nd-card flex flex-col items-center gap-3 px-3 py-3">
                  <div className="relative flex h-28 w-4 items-center justify-center">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={volume}
                      onChange={(event) => onVolumeChange(Number(event.target.value))}
                      onMouseDown={() => setIsVolumeDragging(true)}
                      onMouseUp={() => setIsVolumeDragging(false)}
                      onTouchStart={() => setIsVolumeDragging(true)}
                      onTouchEnd={() => setIsVolumeDragging(false)}
                      className="absolute inset-0 z-10 cursor-pointer opacity-0 [writing-mode:vertical-lr] [direction:rtl]"
                    />
                    <div className="pointer-events-none flex h-full w-1 flex-col justify-end overflow-hidden bg-border-visible">
                      <div className="w-full bg-text-display transition-[height] duration-100" style={{ height: `${volume * 100}%` }} />
                    </div>
                    {isVolumeDragging && (
                      <div
                        className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-md border border-border-visible bg-surface px-2 py-0.5 text-label text-text-primary"
                        style={{ top: `calc(100% - ${volume * 100}%)` }}
                      >
                        {Math.round(volume * 100)}%
                      </div>
                    )}
                  </div>

                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (volume === 0) {
                        onVolumeChange(prevVolumeRef.current || 0.3);
                      } else {
                        prevVolumeRef.current = volume;
                        onVolumeChange(0);
                      }
                    }}
                    className="text-text-secondary transition-colors hover:text-text-display"
                  >
                    {volume === 0 ? <VolumeX size={16} strokeWidth={1.5} /> : <Volume2 size={16} strokeWidth={1.5} />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-lg lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
            <div className="flex items-center gap-sm">
              <button onClick={onPrev} title="Previous track" className="nd-icon-button">
                <SkipBack size={16} strokeWidth={1.5} />
              </button>
              <button
                onClick={onPlayPause}
                title={isPlaying ? 'Pause' : 'Play'}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-full border transition-colors ${
                  isPlaying
                    ? 'border-text-display bg-text-display text-black'
                    : 'border-border-visible text-text-secondary hover:border-text-display hover:text-text-display'
                }`}
              >
                <span key={isPlaying ? 'pause' : 'play'} className="control-pop inline-flex items-center justify-center">
                  {isPlaying ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} className="ml-0.5" />}
                </span>
              </button>
              <button onClick={onNext} title="Next track" className="nd-icon-button">
                <SkipForward size={16} strokeWidth={1.5} />
              </button>
            </div>

            <div className="relative">
              <div className="text-label text-text-disabled">PROGRESS</div>
              <div className="mt-sm flex items-center gap-sm">
                <span className="w-12 text-right text-label text-text-secondary tabular-nums">
                  {formatTime(audioProgress.current)}
                </span>

                <div className="relative flex-1">
                  <input
                    type="range"
                    min="0"
                    max={audioProgress.duration || 0}
                    step="0.1"
                    value={audioProgress.current}
                    onChange={onSeekChange}
                    onMouseDown={onSeekStart}
                    onMouseUp={onSeekEnd}
                    onTouchStart={onSeekStart}
                    onTouchEnd={onSeekEnd}
                    aria-label="Seek"
                    className="absolute inset-0 z-10 h-3 w-full cursor-pointer appearance-none opacity-0"
                  />
                  <div
                    className="pointer-events-none grid gap-[2px]"
                    style={{ gridTemplateColumns: `repeat(${segmentCount}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: segmentCount }).map((_, index) => (
                      <div
                        key={index}
                        className={`h-2 ${index < filledSegmentCount ? 'bg-text-display' : 'bg-border'}`}
                      />
                    ))}
                  </div>
                </div>

                <span className="w-12 text-label text-text-secondary tabular-nums">
                  {formatTime(audioProgress.duration)}
                </span>
              </div>
            </div>

            <div className="text-right">
              <div className="text-label text-text-disabled">OUTPUT</div>
              <div className="mt-sm text-body-sm text-text-primary">
                {radioMode === 'auto' ? 'DJ + radio feed' : 'Direct manual queue'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});

export default PlayerSection;
