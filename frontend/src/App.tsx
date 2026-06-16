import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useChat } from './hooks/useChat';
import { useLogin } from './hooks/useLogin';
import ClockSection from './components/ClockSection';
import PlayerSection from './components/PlayerSection';
import QueuePanel from './components/QueuePanel';
import ChatPanel from './components/ChatPanel';
import HistoryModal from './components/HistoryModal';
import LoginModal from './components/LoginModal';

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [playlist, setPlaylist] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Load playlist
  const loadPlaylist = useCallback(() => {
    fetch('http://localhost:3000/playlist')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setPlaylist(data.map((item: any) => ({
            ...item,
            url: item.url?.startsWith('http') ? item.url : `http://localhost:3000${item.url}`,
          })));
        }
      })
      .catch(console.error);
  }, []);

  // Audio player hook
  const player = useAudioPlayer(playlist, currentIndex, setCurrentIndex as any, setPlaylist);

  // Chat hook
  const chat = useChat(
    player.volume,
    player.gainNodeRef,
    player.isFadingRef,
    player.ttsChunksRef,
    player.ttsAudioRef,
    playlist,
    currentIndex,
    setPlaylist,
    setCurrentIndex,
    player.setIsPlaying,
    player.crossfadeNext,
    player.crossfadePrev,
    player.setErrorToast,
  );

  // Login hook
  const login = useLogin(loadPlaylist);

  // Real-time clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Theme
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // 电台模式列表收起，播放模式列表展开
  useEffect(() => {
    setIsQueueOpen(!player.radioMode);
  }, [player.radioMode]);

  // Load initial data
  useEffect(() => {
    loadPlaylist();
    api.getPlanToday();
  }, [loadPlaylist]);

  const hours = currentTime.getHours().toString().padStart(2, '0');
  const minutes = currentTime.getMinutes().toString().padStart(2, '0');
  const showColon = currentTime.getSeconds() % 2 === 0;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const dayName = days[currentTime.getDay()];
  const monthAbbr = months[currentTime.getMonth()];

  return (
    <div className="min-h-screen bg-surface-raised flex flex-col p-md py-xl transition-colors duration-300">
      <div className="w-full max-w-[650px] mx-auto my-auto bg-black text-text-primary p-lg rounded-2xl border border-border-visible shadow-2xl flex flex-col gap-lg font-body transition-colors duration-300 relative">

        {/* Toast notifications */}
        <div className="fixed top-lg left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-sm pointer-events-none">
          {player.radioToast && (
            <div className="bg-surface-raised border border-border-visible rounded-full px-xl py-sm text-label text-text-primary shadow-lg whitespace-nowrap animate-[fadeIn_0.2s_ease-out]">
              {player.radioToast}
            </div>
          )}
          {player.errorToast && (
            <div className="bg-surface-raised border border-error/30 rounded-full px-xl py-sm text-label text-error shadow-lg whitespace-nowrap animate-[fadeIn_0.2s_ease-out]">
              {player.errorToast}
            </div>
          )}
        </div>

        {/* Header */}
        <header className="flex justify-between items-center w-full">
          <h1 className="text-display-md text-text-display tracking-tight">Uradio</h1>
          <div className="flex gap-sm">
            <button onClick={() => {
              if (login.loggedInUser) {
                login.setIsLoginOpen(true);
                login.setLoginStep('code');
              } else {
                login.openLoginModal();
              }
            }} className="text-label px-md py-xs rounded-full border border-border-visible text-text-secondary hover:text-text-primary hover:border-text-primary transition-colors cursor-pointer active:scale-95">
              {login.loggedInUser ? login.loggedInUser.nickname : 'LOGIN'}
            </button>

            <div className="flex border border-border-visible rounded-full overflow-hidden">
              <button
                onClick={() => setTheme('dark')}
                className={`text-label px-sm py-xs transition-colors cursor-pointer ${theme === 'dark' ? 'bg-surface-raised text-text-primary' : 'text-text-secondary hover:text-text-primary bg-transparent'}`}
              >
                DARK
              </button>
              <button
                onClick={() => setTheme('light')}
                className={`text-label px-sm py-xs transition-colors cursor-pointer ${theme === 'light' ? 'bg-surface-raised text-text-primary' : 'text-text-secondary hover:text-text-primary bg-transparent'}`}
              >
                LIGHT
              </button>
            </div>
          </div>
        </header>

        {/* Clock / Lyrics */}
        <ClockSection
          hours={hours}
          minutes={minutes}
          showColon={showColon}
          dayName={dayName}
          month={monthAbbr}
          date={currentTime.getDate()}
          currentLyric={player.currentLyric}
          lyricLines={player.lyricLines}
          currentLyricIndex={player.currentLyricIndex}
          showLyrics={player.showLyrics}
          isPlaying={player.isPlaying}
          hasCurrentSong={!!player.currentSong}
          isLoggedIn={!!login.loggedInUser}
          onToggleLyrics={() => player.setShowLyrics(prev => !prev)}
          onLoginClick={login.openLoginModal}
        />

        {/* Player */}
        <PlayerSection
          currentSong={player.currentSong}
          isPlaying={player.isPlaying}
          isLoading={player.isLoading}
          volume={player.volume}
          audioProgress={player.audioProgress}
          radioMode={player.radioMode}
          onPlayPause={player.handlePlayPause}
          onPrev={player.crossfadePrev}
          onNext={player.crossfadeNext}
          onVolumeChange={player.setVolume}
          onRadioModeToggle={() => player.setRadioMode(r => !r)}
          onSeekChange={player.handleSeekChange}
          onSeekStart={player.handleSeekStart}
          onSeekEnd={player.handleSeekEnd}
        />

        {/* Hidden audio element */}
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
          onPause={() => { if (player.audioRef.current && !player.audioRef.current.ended) player.setIsPlaying(false); }}
          style={{ display: 'none' }}
        />

        {/* Queue */}
        <QueuePanel
          playlist={playlist}
          currentIndex={currentIndex}
          isPlaying={player.isPlaying}
          isQueueOpen={isQueueOpen}
          onToggle={() => setIsQueueOpen(!isQueueOpen)}
          onSelect={chat.handleQueueSelect}
        />

        {/* Chat */}
        <ChatPanel
          chatMessages={chat.chatMessages}
          isDjTyping={chat.isDjTyping}
          djStreamIdRef={chat.djStreamIdRef}
          chatInput={chat.chatInput}
          playlist={playlist}
          currentIndex={currentIndex}
          chatContainerRef={chat.chatContainerRef}
          onInputChange={chat.setChatInput}
          onSend={chat.handleSendMessage}
          onClearHistory={chat.handleClearHistory}
          onAddTrack={chat.handleAddTrack}
          onViewHistory={() => chat.setIsHistoryOpen(true)}
        />

        {/* Footer */}
        <footer className="w-full flex justify-between items-center text-label text-text-disabled border-t border-border-visible pt-sm flex-shrink-0 mt-auto">
          <span className="tracking-widest">URADIO FM</span>
          <div className="flex gap-xs items-center">
            <div className="w-1.5 h-1.5 rounded-full bg-success"></div>
            <span className="text-success tracking-widest opacity-90">CONNECTED</span>
          </div>
        </footer>

      </div>

      {/* History Modal */}
      <HistoryModal
        isOpen={chat.isHistoryOpen}
        onClose={() => chat.setIsHistoryOpen(false)}
        onLoadSession={chat.handleLoadSession}
        currentSessionId={chat.currentSessionId}
      />

      {/* Login Modal */}
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
