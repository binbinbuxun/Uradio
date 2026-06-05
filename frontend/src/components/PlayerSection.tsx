import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { formatTime } from '../utils';

interface PlayerSectionProps {
  currentSong: any;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  audioProgress: { current: number; duration: number };
  radioMode: boolean;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onVolumeChange: (v: number) => void;
  onRadioModeToggle: () => void;
  onSeekChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSeekStart: () => void;
  onSeekEnd: () => void;
}

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
  onRadioModeToggle,
  onSeekChange,
  onSeekStart,
  onSeekEnd,
}) => {
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const [isVolumeDragging, setIsVolumeDragging] = useState(false);
  const prevVolumeRef = useRef(0.3);

  useEffect(() => {
    if (!isVolumeOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-volume-panel]')) {
        setIsVolumeOpen(false);
        setIsVolumeDragging(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isVolumeOpen]);

  const progressPct = audioProgress.duration > 0 ? (audioProgress.current / audioProgress.duration) * 100 : 0;

  return (
    <section className="w-full border-b border-border-visible pb-md transition-colors duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <div className="flex items-end gap-1 h-6 transition-all duration-300">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="w-1.5 bg-text-secondary rounded-full animate-loading-sweep" style={{ animationDelay: `${i * 0.12}s`, height: `${16 + i * 4}px` }} />
              ))
            ) : isPlaying ? (
              <>
                <div className="w-1.5 bg-success h-3 animate-[pulse_1s_ease-in-out_infinite]"></div>
                <div className="w-1.5 bg-success h-5 animate-[pulse_1.2s_ease-in-out_infinite]"></div>
                <div className="w-1.5 bg-success h-4 animate-[pulse_0.8s_ease-in-out_infinite]"></div>
                <div className="w-1.5 bg-success h-6 animate-[pulse_1.5s_ease-in-out_infinite]"></div>
                <div className="w-1.5 bg-success h-2 animate-[pulse_1.1s_ease-in-out_infinite]"></div>
              </>
            ) : (
              <>
                <div className="w-1.5 bg-text-disabled h-1 opacity-50"></div>
                <div className="w-1.5 bg-text-disabled h-1 opacity-50"></div>
                <div className="w-1.5 bg-text-disabled h-1 opacity-50"></div>
                <div className="w-1.5 bg-text-disabled h-1 opacity-50"></div>
                <div className="w-1.5 bg-text-disabled h-1 opacity-50"></div>
              </>
            )}
          </div>
          <div key={currentSong?.id ?? 'no-song'} className="track-swap">
            <div className="text-body font-bold">{currentSong ? currentSong.name : 'Loading...'}</div>
            <div className="text-label-normal text-text-secondary mt-1">{currentSong ? currentSong.artist : 'Please wait'}</div>
          </div>
        </div>

        <div className="flex items-center gap-sm">
          <button onClick={onPrev} className="p-sm rounded-full border border-border-visible text-text-secondary hover:text-text-primary hover:border-text-primary transition-all cursor-pointer active:scale-95 hover:-translate-x-0.5"><SkipBack size={16} strokeWidth={1.5} /></button>
          <button
            onClick={onPlayPause}
            className={`p-sm rounded-full border transition-all duration-300 cursor-pointer text-center flex justify-center items-center ${
              isPlaying
                ? 'border-interactive text-interactive shadow-[0_0_12px_-4px_var(--interactive)]'
                : 'border-border-visible text-text-secondary hover:text-text-primary hover:border-text-primary'
            } active:scale-90 hover:scale-105`}
          >
            <span key={isPlaying ? 'pause' : 'play'} className="control-pop inline-flex items-center justify-center">
              {isPlaying ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} className="ml-0.5" />}
            </span>
          </button>
          <button onClick={onNext} className="p-sm rounded-full border border-border-visible text-text-secondary hover:text-text-primary hover:border-text-primary transition-all cursor-pointer active:scale-95 hover:translate-x-0.5"><SkipForward size={16} strokeWidth={1.5} /></button>
          <button
            onClick={onRadioModeToggle}
            className={`p-sm rounded-full border transition-all cursor-pointer active:scale-95 text-label ${
              radioMode
                ? 'border-interactive text-interactive shadow-[0_0_12px_-4px_var(--interactive)]'
                : 'border-border-visible text-text-secondary hover:text-text-primary hover:border-text-primary'
            }`}
            title={radioMode ? '电台模式中' : '点击开启电台模式'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M4.93 4.93a10 10 0 0 1 14.14 14.14"/><path d="M2 12a10 10 0 0 1 20 0"/></svg>
          </button>
          <div className="relative ml-2" data-volume-panel>
            <button
              onClick={() => setIsVolumeOpen((prev) => !prev)}
              className="flex items-center gap-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer group px-sm py-[6px] rounded-full border border-border-visible hover:border-text-primary active:scale-95"
            >
              <span className="text-label">VOL</span>
              <Volume2 size={16} strokeWidth={1.5} className="group-hover:scale-110 transition-transform" />
            </button>

            <div className={`absolute right-0 bottom-full mb-2 transition-all duration-200 ease-out ${isVolumeOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-1 pointer-events-none'}`}>
              <div className="flex flex-col items-center gap-2.5 px-2.5 py-2.5 rounded-xl border border-border-visible bg-surface-raised backdrop-blur-sm shadow-xl z-20">
                <div className="relative flex items-center justify-center h-28 w-4">
                  <input
                    type="range" min="0" max="1" step="0.01" value={volume}
                    onChange={(e) => onVolumeChange(Number(e.target.value))}
                    onMouseDown={() => setIsVolumeDragging(true)}
                    onMouseUp={() => setIsVolumeDragging(false)}
                    onTouchStart={() => setIsVolumeDragging(true)}
                    onTouchEnd={() => setIsVolumeDragging(false)}
                    className="absolute inset-0 z-10 opacity-0 cursor-pointer [writing-mode:vertical-lr] [direction:rtl]"
                  />
                  <div className="h-full w-1 bg-border-visible rounded-full overflow-hidden pointer-events-none flex flex-col justify-end">
                    <div className="w-full bg-text-primary rounded-full transition-[height] duration-100" style={{ height: `${volume * 100}%` }} />
                  </div>
                  {isVolumeDragging && (
                    <div className="absolute left-full ml-3 -translate-y-1/2 text-label text-text-primary bg-surface border border-border-visible rounded-md px-2 py-0.5 shadow-sm pointer-events-none whitespace-nowrap" style={{ top: `calc(100% - ${volume * 100}%)` }}>
                      {Math.round(volume * 100)}%
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (volume === 0) {
                      onVolumeChange(prevVolumeRef.current || 0.3);
                    } else {
                      prevVolumeRef.current = volume;
                      onVolumeChange(0);
                    }
                  }}
                  className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                >
                  {volume === 0 ? <VolumeX size={16} strokeWidth={1.5} /> : <Volume2 size={16} strokeWidth={1.5} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-md flex items-center gap-sm">
        <span className="text-label text-text-secondary w-8 text-right tabular-nums">{formatTime(audioProgress.current)}</span>
        <div className="flex-1 relative">
          <input
            type="range" min="0" max={audioProgress.duration || 0} step="0.1" value={audioProgress.current}
            onChange={onSeekChange}
            onMouseDown={onSeekStart}
            onMouseUp={onSeekEnd}
            onTouchStart={onSeekStart}
            onTouchEnd={onSeekEnd}
            aria-label="Seek"
            className="w-full h-1.5 bg-surface-raised rounded-full appearance-none cursor-pointer absolute inset-0 opacity-0 z-10"
          />
          <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden pointer-events-none">
            <div className="h-full bg-text-primary transition-[width] duration-300" style={{ width: `${Math.min(progressPct, 100)}%` }} />
          </div>
        </div>
        <span className="text-label text-text-secondary w-8 tabular-nums">{formatTime(audioProgress.duration)}</span>
      </div>
    </section>
  );
});

export default PlayerSection;
