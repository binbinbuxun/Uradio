import { useCallback, useEffect, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { api } from './api';
import type { QueueState } from './api';
import ChatPanel from './components/ChatPanel';
import HistoryModal from './components/HistoryModal';
import LoginModal from './components/LoginModal';
import QueuePanel from './components/QueuePanel';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useChat } from './hooks/useChat';
import { useLogin } from './hooks/useLogin';
import { formatTime } from './utils';

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [activePanel, setActivePanel] = useState<'queue' | 'dj' | null>(null);
  const [queueState, setQueueState] = useState<QueueState>({
    playlist: [],
    upNext: [],
    currentIndex: 0,
    action: 'pause',
    currentTrackId: null,
    bootstrap: null,
    candidates: { chat: [], radio: [], search: [] },
    historyCount: 0,
  });

  const normalizeTrack = useCallback((item: any) => ({
    ...item,
    id: item.id?.toString?.() || item.id,
    url: item.url?.startsWith('http') ? item.url : `http://localhost:3000${item.url}`,
  }), []);

  const applyQueueState = useCallback((incoming?: Partial<QueueState> | null) => {
    if (!incoming) return;

    setQueueState((prev) => ({
      ...prev,
      ...incoming,
      playlist: Array.isArray(incoming.playlist)
        ? incoming.playlist.map(normalizeTrack)
        : prev.playlist,
      upNext: Array.isArray(incoming.upNext)
        ? incoming.upNext.map(normalizeTrack)
        : prev.upNext,
      candidates: incoming.candidates
        ? {
          chat: (incoming.candidates.chat || []).map(normalizeTrack),
          radio: (incoming.candidates.radio || []).map(normalizeTrack),
          search: (incoming.candidates.search || []).map(normalizeTrack),
        }
        : prev.candidates,
    }));
  }, [normalizeTrack]);

  const setPlaylist = useCallback((value: React.SetStateAction<any[]>) => {
    setQueueState((prev) => ({
      ...prev,
      playlist: typeof value === 'function' ? value(prev.playlist) : value,
    }));
  }, []);

  const setCurrentIndex = useCallback((value: React.SetStateAction<number>) => {
    setQueueState((prev) => ({
      ...prev,
      currentIndex: typeof value === 'function' ? value(prev.currentIndex) : value,
    }));
  }, []);

  const playlist = queueState.playlist;
  const currentIndex = queueState.currentIndex;
  const candidateCount =
    (queueState.candidates?.chat?.length || 0)
    + (queueState.candidates?.radio?.length || 0)
    + (queueState.candidates?.search?.length || 0);
  const upNextCount = Math.max(playlist.length - currentIndex - 1, 0);

  const loadPlaylist = useCallback(() => {
    api.getQueue()
      .then((queue) => {
        applyQueueState(queue);
      })
      .catch(console.error);
  }, [applyQueueState]);

  const player = useAudioPlayer(
    playlist,
    currentIndex,
    setCurrentIndex as any,
    setPlaylist,
    applyQueueState,
  );

  const chat = useChat(
    player.volume,
    player.gainNodeRef,
    player.isFadingRef,
    player.ttsChunksRef,
    player.ttsAudioRef,
    playlist,
    currentIndex,
    applyQueueState,
    player.setIsPlaying,
    player.crossfadeNext,
    player.crossfadePrev,
    player.setErrorToast,
  );

  const login = useLogin(loadPlaylist);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    loadPlaylist();
    api.getPlanToday();
  }, [loadPlaylist]);

  const latestDjMessage = [...chat.chatMessages]
    .reverse()
    .find((message) => message.role === 'dj');
  const currentTrackTitle = player.currentSong?.name || 'Standby';
  const currentTrackArtist = player.currentSong?.artist || 'Uradio waiting for a prompt';
  const lyricPreview = player.currentLyric
    || player.lyricLines.find((line) => line.text.trim())?.text
    || (player.currentSong
      ? 'This track has no synced lyric line in the current source.'
      : 'Tell the DJ what you want to hear to start the next set.');
  const progressPct = player.audioProgress.duration > 0
    ? (player.audioProgress.current / player.audioProgress.duration) * 100
    : 0;

  return (
    <div className="min-h-screen bg-black text-text-primary transition-colors duration-300">
      <div className="relative flex min-h-screen w-full flex-col px-sm py-md sm:px-md sm:py-lg lg:px-lg">
        <div className="pointer-events-none absolute inset-0 dot-grid-subtle opacity-[0.08]" />

        <header className="relative z-10 flex flex-col gap-md px-0 pb-lg font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-sm">
            <span className="font-display text-[clamp(2rem,4vw,3rem)] leading-[0.9] tracking-[-0.05em] text-text-display">
              Uradio
            </span>
          </div>

          <div className="flex flex-col gap-sm sm:items-end">
            <div className="flex flex-wrap items-center gap-sm sm:justify-end">
              <button
                onClick={() => {
                  if (login.loggedInUser) {
                    login.setIsLoginOpen(true);
                    login.setLoginStep('code');
                  } else {
                    login.openLoginModal();
                  }
                }}
                className="text-label text-text-secondary transition-colors hover:text-text-display"
              >
                {login.loggedInUser ? login.loggedInUser.nickname : 'LOGIN'}
              </button>

              <button
                onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                className="text-label text-text-secondary transition-colors hover:text-text-display"
              >
                {theme === 'dark' ? 'LIGHT MODE' : 'DARK MODE'}
              </button>
            </div>
            <span className="text-left sm:text-right">QUEUE {playlist.length} // NEXT {upNextCount} // PICKS {candidateCount}</span>
          </div>
        </header>

        <main className="relative z-10 flex flex-1 flex-col justify-center px-0 py-2xl lg:py-3xl">
          <section className="mb-2xl max-w-[920px]">
            <div className="mb-md flex items-center gap-sm">
              <div className={`h-2 w-2 rounded-full ${chat.isDjTyping || player.isPlaying ? 'bg-accent' : 'bg-border-visible'}`} />
              <span className={`text-label ${chat.isDjTyping || player.isPlaying ? 'text-accent' : 'text-text-secondary'}`}>
                {chat.isDjTyping ? 'AI DJ // LIVE SEGUE' : 'AI DJ // LAST MESSAGE'}
              </span>
            </div>

            <div className="max-w-[780px] text-left text-[clamp(1.25rem,2.2vw,1.75rem)] leading-[1.45] text-text-display">
              <span>{latestDjMessage?.content || 'The AI DJ is ready. Ask for a mood, a scene, or a specific artist to shape the next transition.'}</span>
              <span className={`ml-[4px] inline-block h-[1em] w-[10px] align-middle ${chat.isDjTyping ? 'bg-accent animate-[cursor-blink_1s_step-end_infinite]' : 'bg-text-display animate-[cursor-blink_1.2s_step-end_infinite]'}`} />
            </div>
          </section>

          <section className="flex flex-col items-start text-left">
            <h2 className="mb-sm text-[clamp(1.125rem,2vw,1.75rem)] text-text-secondary">
              {currentTrackArtist}
            </h2>
            <h1 className="max-w-[1100px] text-[clamp(3.5rem,10vw,8rem)] font-body font-medium leading-[0.92] tracking-[-0.05em] text-text-display">
              {currentTrackTitle}
            </h1>
            <p className="mt-lg max-w-[520px] border-l border-border-visible pl-sm text-body-sm italic text-text-secondary">
              {lyricPreview}
            </p>
          </section>
        </main>

        <footer className="relative z-10 border-t border-border-visible/70 px-0 pt-lg">
          <div className="relative h-px w-full bg-border">
            <div className="absolute inset-y-0 left-0 bg-text-display" style={{ width: `${Math.min(progressPct, 100)}%` }} />
            <div
              className="absolute top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-accent"
              style={{ left: `calc(${Math.min(progressPct, 100)}% - 3px)` }}
            />
          </div>

          <div className="mt-lg flex flex-col gap-md xl:flex-row xl:items-end xl:justify-between">
            <div className="flex flex-col gap-md">
              <div className="flex flex-wrap items-center gap-sm">
                <button onClick={player.crossfadePrev} className="nd-transport-button" title="Previous">
                  <SkipBack size={18} strokeWidth={1.5} />
                </button>
                <button
                  onClick={player.handlePlayPause}
                  className={player.isPlaying ? 'nd-transport-button-primary' : 'nd-transport-button'}
                  title={player.isPlaying ? 'Pause' : 'Play'}
                >
                  {player.isPlaying ? <Pause size={18} strokeWidth={1.5} /> : <Play size={18} strokeWidth={1.5} className="ml-[2px]" />}
                </button>
                <button onClick={player.crossfadeNext} className="nd-transport-button" title="Next">
                  <SkipForward size={18} strokeWidth={1.5} />
                </button>
                <span className="ml-sm font-mono text-sm uppercase tracking-[0.06em] text-text-secondary">
                  {formatTime(player.audioProgress.current)} / {formatTime(player.audioProgress.duration)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-md font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary">
                <button
                  onClick={() => setActivePanel((prev) => (prev === 'queue' ? null : 'queue'))}
                  className={`transition-colors ${activePanel === 'queue' ? 'text-text-display' : 'hover:text-text-display'}`}
                >
                  {activePanel === 'queue' ? '[ HIDE QUEUE ]' : `[ QUEUE ${playlist.length} ]`}
                </button>
                <button
                  onClick={() => setActivePanel((prev) => (prev === 'dj' ? null : 'dj'))}
                  className={`transition-colors ${activePanel === 'dj' ? 'text-text-display' : 'hover:text-text-display'}`}
                >
                  {activePanel === 'dj' ? '[ HIDE DJ LOG ]' : '[ DJ LOG ]'}
                </button>
                <button
                  onClick={() => chat.setIsHistoryOpen(true)}
                  className="transition-colors hover:text-text-display"
                >
                  [ HISTORY ]
                </button>
                <button
                  onClick={() => player.setRadioMode((prev) => (prev === 'auto' ? 'manual' : 'auto'))}
                  className="transition-colors hover:text-text-display"
                >
                  [{player.radioMode === 'auto' ? ' AUTO RADIO ' : ' MANUAL QUEUE '}]
                </button>
              </div>
            </div>

            <div className="w-full max-w-[420px] border-b border-border-visible pb-xs xl:ml-auto">
              <div className="flex items-center gap-sm">
                <span className="font-mono text-xs uppercase tracking-[0.08em] text-accent">&gt;</span>
                <input
                  type="text"
                  placeholder="Tell the DJ what to play..."
                  className="w-full bg-transparent text-body-sm text-text-display placeholder:text-text-disabled focus:outline-none"
                  value={chat.chatInput}
                  onChange={(event) => chat.setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      chat.handleSendMessage();
                    }
                  }}
                />
                <button
                  onClick={chat.handleSendMessage}
                  disabled={!chat.chatInput.trim()}
                  className={`font-mono text-xs uppercase tracking-[0.08em] transition-colors ${
                    chat.chatInput.trim() ? 'text-text-display hover:text-accent' : 'text-text-disabled'
                  }`}
                >
                  SEND
                </button>
              </div>
            </div>
          </div>
        </footer>

        {activePanel === 'queue' && (
          <div className="relative z-10 mt-lg">
            <QueuePanel
              queueState={queueState}
              isPlaying={player.isPlaying}
              isQueueOpen
              onToggle={() => setActivePanel(null)}
              onSelect={chat.handleQueueSelect}
              onRemove={chat.handleRemoveQueueTrack}
              onClearUpcoming={chat.handleClearUpcoming}
              onMove={chat.handleMoveQueueTrack}
              onCandidateAction={chat.handleAddTrack}
              onRejectCandidate={chat.handleRejectCandidate}
            />
          </div>
        )}

        {activePanel === 'dj' && (
          <div className="relative z-10 mt-lg">
            <ChatPanel
              chatMessages={chat.chatMessages}
              isDjTyping={chat.isDjTyping}
              djStreamIdRef={chat.djStreamIdRef}
              chatInput={chat.chatInput}
              playlist={playlist}
              chatContainerRef={chat.chatContainerRef}
              onInputChange={chat.setChatInput}
              onSend={chat.handleSendMessage}
              onClearHistory={chat.handleClearHistory}
              onOpenHistory={() => chat.setIsHistoryOpen(true)}
              onAddTrack={chat.handleAddTrack}
              showComposer={false}
            />
          </div>
        )}

        <audio
          ref={player.audioRef}
          crossOrigin="anonymous"
          onEnded={player.handleSongEnd}
          onError={player.handleTrackError}
          onTimeUpdate={player.handleTimeUpdate}
          onLoadedMetadata={player.handleLoadedMetadata}
          onWaiting={() => player.setIsLoading(true)}
          onCanPlay={() => player.setIsLoading(false)}
          onPlaying={() => player.setIsLoading(false)}
          onPlay={() => player.setIsPlaying(true)}
          onPause={() => {
            if (player.audioRef.current && !player.audioRef.current.ended) {
              player.setIsPlaying(false);
            }
          }}
          style={{ display: 'none' }}
        />
      </div>

      <HistoryModal
        isOpen={chat.isHistoryOpen}
        onClose={() => chat.setIsHistoryOpen(false)}
        onLoadSession={chat.handleLoadSession}
        onReplayTrack={chat.handleAddTrack}
        currentSessionId={chat.currentSessionId}
      />

      <LoginModal
        isOpen={login.isLoginOpen}
        loggedInUser={login.loggedInUser}
        cookieExpiresAt={login.cookieExpiresAt}
        timeRemaining={login.timeRemaining}
        phoneInput={login.phoneInput}
        captchaInput={login.captchaInput}
        loginStep={login.loginStep}
        loginStatus={login.loginStatus}
        countdown={login.countdown}
        loginNickname={login.loginNickname}
        onClose={() => login.setIsLoginOpen(false)}
        onSendCaptcha={login.handleSendCaptcha}
        onPhoneLogin={login.handlePhoneLogin}
        onLogout={login.handleLogout}
        onPhoneInputChange={login.setPhoneInput}
        onCaptchaInputChange={login.setCaptchaInput}
        onLoginStepChange={login.setLoginStep}
      />
    </div>
  );
}

export default App;
