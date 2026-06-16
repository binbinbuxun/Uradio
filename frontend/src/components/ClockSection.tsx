import React from 'react';

interface ClockSectionProps {
  hours: string;
  minutes: string;
  showColon: boolean;
  dayName: string;
  month: string;
  date: number;
  currentLyric: string;
  lyricLines: { time: number; text: string }[];
  currentLyricIndex: number;
  showLyrics: boolean;
  isPlaying: boolean;
  hasCurrentSong: boolean;
  isLoggedIn: boolean;
  onToggleLyrics: () => void;
  onLoginClick: () => void;
}

const ClockSection: React.FC<ClockSectionProps> = React.memo(({
  hours,
  minutes,
  showColon,
  dayName,
  month,
  date,
  currentLyric,
  lyricLines,
  currentLyricIndex,
  showLyrics,
  isPlaying,
  hasCurrentSong,
  isLoggedIn,
  onToggleLyrics,
  onLoginClick,
}) => {
  return (
    <section
      className={`w-full bg-surface border border-border-visible rounded-lg relative overflow-hidden flex-shrink-0 h-[260px] transition-colors duration-300 ${hasCurrentSong ? 'cursor-pointer' : ''}`}
      onClick={() => { if (hasCurrentSong) onToggleLyrics(); }}
    >
      <div className="absolute inset-0 dot-grid-subtle opacity-20 pointer-events-none"></div>

      <div className={`absolute inset-0 z-10 flex flex-col items-center justify-center transition-all duration-300 ${showLyrics ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="text-[100px] font-display text-text-display leading-none tracking-[-0.05em] flex items-center">
          <span>{hours}</span>
          <span className="flex flex-col items-center justify-center mx-2 gap-[6px] self-center">
            <div className={`w-[7px] h-[7px] rounded-full bg-text-display transition-all duration-500 ease-out ${showColon ? 'opacity-80 scale-100' : 'opacity-15 scale-75'}`} />
            <div className={`w-[7px] h-[7px] rounded-full bg-text-display transition-all duration-500 ease-out ${showColon ? 'opacity-80 scale-100' : 'opacity-15 scale-75'}`} />
          </span>
          <span>{minutes}</span>
        </div>

        <div className="text-label text-text-secondary tracking-widest mt-sm">{dayName} {month} {date}</div>

        {currentLyric && (
          <div key={currentLyric} className="text-label-normal text-text-primary text-center max-w-[400px] leading-relaxed my-sm animate-lyric-swap">{currentLyric}</div>
        )}
        {!isLoggedIn && (
          <button
            onClick={(e) => { e.stopPropagation(); onLoginClick(); }}
            className="text-label text-interactive underline underline-offset-2 hover:opacity-80 transition-opacity cursor-pointer my-sm"
          >
            LOGIN FOR DAILY RECOMMENDATIONS
          </button>
        )}
        <div className="flex items-center gap-xs">
          <div className={`w-2 h-2 rounded-full transition-all duration-500 ease-out ${isPlaying ? 'bg-success animate-pulse-slow scale-100 opacity-100' : 'bg-text-disabled scale-75 opacity-50'}`}></div>
          <span className={`text-label transition-all duration-500 ease-out ${isPlaying ? 'text-success opacity-100' : 'text-text-disabled opacity-60'}`}>
            {isPlaying ? 'ON AIR' : 'OFF AIR'}
          </span>
        </div>
      </div>

      <div className={`absolute inset-0 z-10 flex flex-col transition-all duration-300 ${showLyrics ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute top-lg left-lg text-label text-text-secondary font-mono">
          {hours}:{minutes}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-sm px-xl">
          {lyricLines.length > 0 ? (
            <>
              <div key={'prev-' + currentLyricIndex} className="text-[20px] text-text-secondary opacity-50 text-center leading-tight animate-lyric-swap">
                {currentLyricIndex > 0 && lyricLines[currentLyricIndex - 1] ? lyricLines[currentLyricIndex - 1].text : ' '}
              </div>
              <div key={'current-' + currentLyricIndex} className="text-[24px] font-body text-text-display font-medium text-center leading-tight animate-lyric-swap">
                {currentLyricIndex >= 0 && lyricLines[currentLyricIndex] ? lyricLines[currentLyricIndex].text : ' '}
              </div>
              <div key={'next-' + currentLyricIndex} className="text-[20px] text-text-secondary opacity-50 text-center leading-tight animate-lyric-swap">
                {currentLyricIndex >= 0 && currentLyricIndex < lyricLines.length - 1 && lyricLines[currentLyricIndex + 1] ? lyricLines[currentLyricIndex + 1].text : ' '}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-sm">
              <div className="w-8 h-8 rounded-full border border-border-visible flex items-center justify-center">
                <span className="text-caption text-text-disabled">♪</span>
              </div>
              <span className="text-label text-text-disabled tracking-widest">No lyrics available</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
});

export default ClockSection;
