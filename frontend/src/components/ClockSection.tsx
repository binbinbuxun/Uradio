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
      className={`relative min-h-[400px] overflow-hidden rounded-[18px] border border-border-visible bg-surface transition-colors duration-300 ${hasCurrentSong ? 'cursor-pointer' : ''}`}
      onClick={() => {
        if (hasCurrentSong) {
          onToggleLyrics();
        }
      }}
    >
      <div className="pointer-events-none absolute inset-0 dot-grid-subtle opacity-20" />

      <div className="relative z-10 flex h-full flex-col gap-lg p-lg sm:p-xl lg:p-2xl">
        <div className="flex items-start justify-between gap-md">
          <div>
            <div className="text-label text-text-secondary">LOCAL CLOCK</div>
            <div className="mt-xs text-caption text-text-disabled">
              {dayName} / {month} {date}
            </div>
          </div>

          <div className="flex items-center gap-xs">
            <div className={`h-2 w-2 rounded-full transition-colors ${isPlaying ? 'bg-accent' : 'bg-border-visible'}`} />
            <span className={`text-label ${isPlaying ? 'text-accent' : 'text-text-secondary'}`}>
              {isPlaying ? 'ON AIR' : 'STANDBY'}
            </span>
          </div>
        </div>

        <div className="grid flex-1 gap-xl lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)] lg:items-end">
          <div className="flex min-w-0 flex-col justify-end">
            <div className="flex items-center text-[clamp(5rem,18vw,10rem)] font-display leading-[0.85] tracking-[-0.06em] text-text-display">
              <span>{hours}</span>
              <span className="mx-2 flex flex-col items-center justify-center gap-[8px] self-center">
                <div className={`h-[8px] w-[8px] rounded-full bg-text-display transition-opacity duration-500 ${showColon ? 'opacity-100' : 'opacity-20'}`} />
                <div className={`h-[8px] w-[8px] rounded-full bg-text-display transition-opacity duration-500 ${showColon ? 'opacity-100' : 'opacity-20'}`} />
              </span>
              <span>{minutes}</span>
            </div>

            <div className="mt-md flex flex-wrap items-center gap-sm">
              <span className="text-label text-text-disabled">CURRENT STATE</span>
              <span className="text-label text-text-secondary">
                {hasCurrentSong ? 'TRACK LOADED' : 'WAITING FOR PLAYBACK'}
              </span>
            </div>
          </div>

          <div className="border-t border-border-visible pt-lg lg:border-l lg:border-t-0 lg:pl-xl lg:pt-0">
            {!showLyrics && (
              <div className="flex h-full flex-col justify-end gap-md">
                <div className="text-label text-text-disabled">LIVE CONTEXT</div>
                <div
                  key={currentLyric || 'empty-lyric'}
                  className="max-w-[28ch] text-heading text-text-display animate-lyric-swap"
                >
                  {currentLyric || 'Tap the console to switch into lyric focus while a track is playing.'}
                </div>
                <div className="max-w-[30ch] text-body-sm text-text-secondary">
                  {hasCurrentSong
                    ? 'The homepage now prioritizes current playback first, then queue and DJ control.'
                    : 'Load a track or ask the DJ for a mood, artist, or moment to start the stream.'}
                </div>
                {!isLoggedIn && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onLoginClick();
                    }}
                    className="self-start text-label text-interactive transition-opacity hover:opacity-80"
                  >
                    LOGIN FOR DAILY RECOMMENDATIONS
                  </button>
                )}
              </div>
            )}

            {showLyrics && (
              <div className="flex h-full flex-col justify-end gap-md">
                <div className="text-label text-text-disabled">LYRIC FOCUS</div>
                {lyricLines.length > 0 ? (
                  <div className="flex flex-col gap-sm">
                    <div key={`prev-${currentLyricIndex}`} className="text-body-sm text-text-secondary animate-lyric-swap">
                      {currentLyricIndex > 0 && lyricLines[currentLyricIndex - 1]
                        ? lyricLines[currentLyricIndex - 1].text
                        : ' '}
                    </div>
                    <div key={`current-${currentLyricIndex}`} className="text-heading text-text-display animate-lyric-swap">
                      {currentLyricIndex >= 0 && lyricLines[currentLyricIndex]
                        ? lyricLines[currentLyricIndex].text
                        : ' '}
                    </div>
                    <div key={`next-${currentLyricIndex}`} className="text-body-sm text-text-secondary animate-lyric-swap">
                      {currentLyricIndex >= 0
                      && currentLyricIndex < lyricLines.length - 1
                      && lyricLines[currentLyricIndex + 1]
                        ? lyricLines[currentLyricIndex + 1].text
                        : ' '}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-sm">
                    <div className="text-heading text-text-display">No lyric data</div>
                    <div className="text-body-sm text-text-secondary">
                      This track does not expose synchronized lines through the current backend source.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-sm border-t border-border-visible pt-md">
          <span className="text-label text-text-disabled">
            {hasCurrentSong ? (showLyrics ? 'TAP TO RETURN TO CLOCK' : 'TAP TO OPEN LYRIC FOCUS') : 'HOME SCREEN IDLE'}
          </span>
          <span className="max-w-[28rem] truncate text-caption text-text-secondary">
            {currentLyric || 'Clock, playback, queue, and DJ conversation now sit in one control surface.'}
          </span>
        </div>
      </div>
    </section>
  );
});

export default ClockSection;
