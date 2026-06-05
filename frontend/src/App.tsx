import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, connectStream } from './api';
import { parseLRC } from './utils';
import ClockSection from './components/ClockSection';
import PlayerSection from './components/PlayerSection';
import QueuePanel from './components/QueuePanel';
import ChatPanel from './components/ChatPanel';
import LoginModal from './components/LoginModal';

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isPlaying, setIsPlaying] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [playlist, setPlaylist] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [volume, setVolume] = useState(0.3);
  const [isLoading, setIsLoading] = useState(false);
  const [audioProgress, setAudioProgress] = useState({ current: 0, duration: 0 });
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [loginStep, setLoginStep] = useState<'phone' | 'code'>('phone');
  const [loginStatus, setLoginStatus] = useState<'idle' | 'sending' | 'code-sent' | 'logging-in' | 'success' | 'error'>('idle');
  const [countdown, setCountdown] = useState(0);
  const [loginNickname, setLoginNickname] = useState('');
  const [loggedInUser, setLoggedInUser] = useState<{ nickname: string } | null>(null);
  const [lyricLines, setLyricLines] = useState<{ time: number; text: string }[]>([]);
  const [currentLyric, setCurrentLyric] = useState('');
  const [showLyrics, setShowLyrics] = useState(false);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [cookieExpiresAt, setCookieExpiresAt] = useState<number | null>(() => {
    const stored = localStorage.getItem('cookieExpiresAt');
    return stored ? parseInt(stored, 10) : null;
  });
  const [timeRemaining, setTimeRemaining] = useState('');
  const [chatMessages, setChatMessages] = useState<{ id: string; role: 'user' | 'dj'; content: string; timestamp: number; recommendedSongs?: any[]; searchResults?: any[] }[]>([]);
  const [isDjTyping, setIsDjTyping] = useState(false);
  const [radioMode, setRadioMode] = useState(() => {
    // 默认开启电台模式
    const stored = localStorage.getItem('uradio_radio_mode');
    return stored === null ? true : stored === 'true';
  });
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const djStreamIdRef = useRef<string | null>(null);
  const msgCounter = useRef(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const prefetchedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsChunksRef = useRef<string[]>([]);
  const isSeeking = useRef(false);
  const prevVolumeRef = useRef(0.3);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const isFadingRef = useRef(false);
  const audioChainInitRef = useRef(false);
  const openingPlayedRef = useRef(false);

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

  // Cookie countdown
  useEffect(() => {
    if (!cookieExpiresAt) return;
    const update = () => {
      const remaining = cookieExpiresAt - Date.now();
      if (remaining <= 0) {
        setTimeRemaining('EXPIRED');
        return;
      }
      const days = Math.floor(remaining / 86400000);
      const hours = Math.floor((remaining % 86400000) / 3600000);
      setTimeRemaining(`${days}d ${hours}h`);
    };
    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, [cookieExpiresAt]);

  // Captcha countdown
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const currentSong = playlist.length > 0 ? playlist[currentIndex] : null;

  // AudioContext init
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || audioChainInitRef.current) return;
    audioChainInitRef.current = true;

    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const compressor = ctx.createDynamicsCompressor();
      const gainNode = ctx.createGain();

      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      source.connect(compressor);
      compressor.connect(gainNode);
      gainNode.connect(ctx.destination);

      audio.volume = 1;
      audioContextRef.current = ctx;
      gainNodeRef.current = gainNode;
      gainNode.gain.value = volume * volume;
    } catch (e) {
      console.warn('AudioContext setup failed', e);
    }
  }, []);

  // Core playback: load new song
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    audio.src = currentSong.url;
    audio.load();
    setAudioProgress({ current: 0, duration: 0 });
    prefetchedRef.current = false;

    if (isPlaying) {
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      audio.play().catch((e) => {
        if (e.name !== 'AbortError') console.log('Play failed:', e);
      });
    }
  }, [currentSong?.id]);

  // Sync play/pause
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    if (isPlaying) {
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      audio.play().catch((e) => {
        if (e.name !== 'AbortError') console.log('Play failed:', e);
      });
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  // Sync volume
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = volume === 0;
    if (gainNodeRef.current && !isFadingRef.current) {
      gainNodeRef.current.gain.value = volume * volume;
      audio.volume = 1;
    } else if (!gainNodeRef.current) {
      audio.volume = volume * volume;
    }
  }, [volume]);

  // Media Session API
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentSong) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.name,
      artist: currentSong.artist,
      album: 'Uradio',
      artwork: currentSong.cover
        ? [{ src: currentSong.cover, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });

    navigator.mediaSession.setActionHandler('play', () => setIsPlaying(true));
    navigator.mediaSession.setActionHandler('pause', () => setIsPlaying(false));
    navigator.mediaSession.setActionHandler('previoustrack', () => onCrossfadePrev.current());
    navigator.mediaSession.setActionHandler('nexttrack', () => onCrossfadeNext.current());
  }, [currentSong?.id]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);

  // Auto-scroll chat
  useEffect(() => {
    chatContainerRef.current?.scrollTo({
      top: chatContainerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [chatMessages, isDjTyping]);

  // Load chat history on mount
  useEffect(() => {
    api.getChatHistory(50).then((history) => {
      if (history.length > 0) {
        setChatMessages(history);
        setHistoryLoaded(true);
      }
    }).catch(console.error);
  }, []);

  // Persist radio mode
  useEffect(() => {
    localStorage.setItem('uradio_radio_mode', String(radioMode));
  }, [radioMode]);

  // 电台模式列表收起，播放模式列表展开
  useEffect(() => {
    setIsQueueOpen(!radioMode);
  }, [radioMode]);

  // Check login state on mount
  useEffect(() => {
    const stored = localStorage.getItem('uradio_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.nickname) {
          setLoggedInUser({ nickname: parsed.nickname });
        }
      } catch {}
    }
    fetch('http://localhost:3000/api/login-status')
      .then(res => res.json())
      .then(data => {
        if (!data.loggedIn) {
          setLoggedInUser(null);
          localStorage.removeItem('uradio_user');
        }
      })
      .catch(() => {});
  }, []);

  // Fetch lyrics
  useEffect(() => {
    if (!currentSong?.id) return;
    setLyricLines([]);
    setCurrentLyric('');
    setCurrentLyricIndex(-1);
    fetch(`http://localhost:3000/api/lyric/${currentSong.id}`)
      .then(res => res.json())
      .then(data => {
        if (data.lyric) {
          const parsed = parseLRC(data.lyric);
          setLyricLines(parsed);
          if (parsed.length > 0) setCurrentLyricIndex(0);
        }
      })
      .catch(() => {});
  }, [currentSong?.id]);

  // Load playlist
  const loadPlaylist = useCallback(() => {
    fetch('http://localhost:3000/playlist')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setPlaylist(data.map((item) => ({
            ...item,
            url: item.url?.startsWith('http') ? item.url : `http://localhost:3000${item.url}`,
          })));
        }
      })
      .catch(console.error);
  }, []);

  // WebSocket + initial data
  useEffect(() => {
    loadPlaylist();
    api.getPlanToday();

    const ws = connectStream((msg) => {
      if (msg.type === 'chat-stream') {
        const payload = msg.data?.data || msg.data;
        const { delta, done, metadata } = payload;

        if (delta && !djStreamIdRef.current) {
          msgCounter.current++;
          const newId = `dj_${msgCounter.current}`;
          djStreamIdRef.current = newId;
          ttsChunksRef.current = [];
          setIsDjTyping(true);
          setChatMessages((msgs) => [
            ...msgs,
            { id: newId, role: 'dj', content: delta, timestamp: Date.now() },
          ]);
          return;
        }

        if (delta && djStreamIdRef.current) {
          setChatMessages((msgs) => {
            const idx = msgs.findIndex((m) => m.id === djStreamIdRef.current);
            if (idx >= 0) {
              const updated = [...msgs];
              updated[idx] = { ...updated[idx], content: updated[idx].content + delta };
              return updated;
            }
            return msgs;
          });
        }

        if (metadata?.ttsChunk) {
          ttsChunksRef.current.push(metadata.ttsChunk);
        }

        if (metadata?.ttsDone) {
          if (ttsAudioRef.current) {
            ttsAudioRef.current.pause();
            ttsAudioRef.current = null;
          }

          const chunks = ttsChunksRef.current;
          ttsChunksRef.current = [];
          if (chunks.length === 0) return;

          const gainNode = gainNodeRef.current;
          const currentVol = volume;
          if (gainNode) gainNode.gain.value = currentVol * currentVol * 0.2;

          try {
            const totalLength = chunks.reduce((sum, c) => sum + atob(c).length, 0);
            const arr = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              const raw = atob(chunk);
              for (let i = 0; i < raw.length; i++) arr[offset++] = raw.charCodeAt(i);
            }
            const blob = new Blob([arr], { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            const ttsAudio = new Audio(url);
            ttsAudioRef.current = ttsAudio;

            ttsAudio.onended = () => {
              if (gainNode) gainNode.gain.value = currentVol * currentVol;
              URL.revokeObjectURL(url);
              ttsAudioRef.current = null;
            };
            ttsAudio.onerror = () => {
              if (gainNode) gainNode.gain.value = currentVol * currentVol;
              URL.revokeObjectURL(url);
              ttsAudioRef.current = null;
            };
            ttsAudio.play().catch(() => {
              if (gainNode) gainNode.gain.value = currentVol * currentVol;
              URL.revokeObjectURL(url);
              ttsAudioRef.current = null;
            });
          } catch {
            if (gainNode) gainNode.gain.value = currentVol * currentVol;
          }
        }

        if (metadata?.recommendedSongs && djStreamIdRef.current) {
          const songs = metadata.recommendedSongs;
          setChatMessages((msgs) => {
            const idx = msgs.findIndex((m) => m.id === djStreamIdRef.current);
            if (idx >= 0) {
              const updated = [...msgs];
              updated[idx] = { ...updated[idx], recommendedSongs: songs };
              return updated;
            }
            return msgs;
          });
        }

        if (metadata?.searchResults && djStreamIdRef.current) {
          const songs = metadata.searchResults;
          setChatMessages((msgs) => {
            const idx = msgs.findIndex((m) => m.id === djStreamIdRef.current);
            if (idx >= 0) {
              const updated = [...msgs];
              updated[idx] = { ...updated[idx], searchResults: songs };
              return updated;
            }
            return msgs;
          });
        }

        if (done) {
          djStreamIdRef.current = null;
          setIsDjTyping(false);
        }
      }

      if (msg.type === 'now-playing') {
        // handled
      }

      if (msg.type === 'control') {
        const payload = msg.data?.data || msg.data;
        const { command, payload: cmdPayload } = payload;

        switch (command) {
          case 'next':
            onCrossfadeNext.current();
            break;
          case 'prev':
            onCrossfadePrev.current();
            break;
          case 'pause':
            setIsPlaying(false);
            break;
          case 'play':
            setIsPlaying(true);
            break;
          case 'volume':
            if (cmdPayload?.volume !== undefined) {
              setVolume(cmdPayload.volume);
            }
            break;
        }
      }

      if (msg.type === 'playlist-update') {
        const payload = msg.data?.data || msg.data;
        const { action, songs, playlist: newPlaylist } = payload;

        const mapTrack = (item: any) => ({
          ...item,
          name: item.name || item.title || '',
          url: item.url?.startsWith('http') ? item.url : `http://localhost:3000${item.url}`,
        });

        if (action === 'replace' && newPlaylist) {
          setPlaylist(newPlaylist.map(mapTrack));
        } else if (action === 'add' && songs) {
          setPlaylist(prev => {
            const updated = [...prev];
            const insertAt = currentIndex + 1;
            updated.splice(insertAt, 0, ...songs.map(mapTrack));
            return updated;
          });
        } else if (action === 'remove' && newPlaylist) {
          setPlaylist(newPlaylist.map(mapTrack));
        }
      }
    });

    return () => {
      if (ws) ws.close();
    };
  }, []);

  const nextTrack = useCallback(() => {
    if (playlist.length === 0) return;
    const nextIndex = (currentIndex + 1) % playlist.length;
    setCurrentIndex(nextIndex);
    setIsPlaying(true);
  }, [playlist.length, currentIndex]);

  const handleSongEnd = useCallback(async () => {
    if (playlist.length === 0) return;

    if (radioMode) {
      try {
        const segue = await api.getSegueNext();
        if (segue?.ttsBase64 && segue.text) {
          const arr = new Uint8Array(
            atob(segue.ttsBase64).split('').map(c => c.charCodeAt(0)),
          );
          const blob = new Blob([arr], { type: 'audio/mpeg' });
          const url = URL.createObjectURL(blob);
          const ttsAudio = new Audio(url);

          const gainNode = gainNodeRef.current;
          const prevGain = gainNode?.gain.value ?? 0.3;
          if (gainNode) gainNode.gain.value = prevGain * 0.2;

          await new Promise<void>((resolve) => {
            ttsAudio.onended = () => {
              if (gainNode) gainNode.gain.value = prevGain;
              URL.revokeObjectURL(url);
              resolve();
            };
            ttsAudio.onerror = () => {
              if (gainNode) gainNode.gain.value = prevGain;
              URL.revokeObjectURL(url);
              resolve();
            };
            ttsAudio.play().catch(() => resolve());
          });

          // 处理推荐歌曲：插入到播放列表
          if (segue.type === 'recommendation' && segue.recommendedSongs?.length) {
            const newTracks = segue.recommendedSongs.map((s: any) => ({
              id: s.id,
              name: s.name,
              artist: s.artist,
              cover: s.cover,
              url: `/audio/${s.id}`,
            }));
            setPlaylist(prev => {
              const insertAt = currentIndex + 1;
              const updated = [...prev];
              updated.splice(insertAt, 0, ...newTracks);
              return updated;
            });
          }
        }
      } catch {
        // segue failed, just skip
      }
    }

    const nextIndex = (currentIndex + 1) % playlist.length;
    setCurrentIndex(nextIndex);
    setIsPlaying(true);
  }, [playlist.length, currentIndex, radioMode]);

  const prevTrack = useCallback(() => {
    if (playlist.length === 0) return;
    const nextIndex = (currentIndex - 1 + playlist.length) % playlist.length;
    setCurrentIndex(nextIndex);
    setIsPlaying(true);
  }, [playlist.length, currentIndex]);

  // Crossfade next
  const crossfadeNext = useCallback(() => {
    const gainNode = gainNodeRef.current;
    if (!gainNode || isFadingRef.current) return;
    const targetGain = volume * volume;
    const startGain = gainNode.gain.value;
    const fadeDuration = 250;
    const startTime = performance.now();

    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }

    isFadingRef.current = true;

    const fadeOut = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / fadeDuration, 1);
      gainNode.gain.value = startGain * (1 - progress);
      if (progress < 1) {
        requestAnimationFrame(fadeOut);
      } else {
        gainNode.gain.value = 0;
        nextTrack();
        requestAnimationFrame(fadeIn);
      }
    };

    const fadeIn = (now: number) => {
      const elapsed = now - (startTime + fadeDuration);
      const progress = Math.min(elapsed / fadeDuration, 1);
      gainNode.gain.value = targetGain * progress;
      if (progress < 1) {
        requestAnimationFrame(fadeIn);
      } else {
        gainNode.gain.value = targetGain;
        isFadingRef.current = false;
      }
    };

    requestAnimationFrame(fadeOut);
  }, [volume, nextTrack]);

  const crossfadePrev = useCallback(() => {
    const gainNode = gainNodeRef.current;
    if (!gainNode || isFadingRef.current) return;
    const targetGain = volume * volume;
    const startGain = gainNode.gain.value;
    const fadeDuration = 250;
    const startTime = performance.now();

    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }

    isFadingRef.current = true;

    const fadeOut = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / fadeDuration, 1);
      gainNode.gain.value = startGain * (1 - progress);
      if (progress < 1) {
        requestAnimationFrame(fadeOut);
      } else {
        gainNode.gain.value = 0;
        prevTrack();
        requestAnimationFrame(fadeIn);
      }
    };

    const fadeIn = (now: number) => {
      const elapsed = now - (startTime + fadeDuration);
      const progress = Math.min(elapsed / fadeDuration, 1);
      gainNode.gain.value = targetGain * progress;
      if (progress < 1) {
        requestAnimationFrame(fadeIn);
      } else {
        gainNode.gain.value = targetGain;
        isFadingRef.current = false;
      }
    };

    requestAnimationFrame(fadeOut);
  }, [volume, prevTrack]);

  const onCrossfadeNext = useRef(crossfadeNext);
  const onCrossfadePrev = useRef(crossfadePrev);
  onCrossfadeNext.current = crossfadeNext;
  onCrossfadePrev.current = crossfadePrev;

  const handlePlayPause = () => {
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }

    // 暂停 → 播放：如果在电台模式且还没播过开场白，先播开场白
    if (!isPlaying && radioMode && !openingPlayedRef.current && currentSong) {
      openingPlayedRef.current = true;
      console.log('[Opening] Fetching opening TTS... volume=', volume);
      api.getOpening(volume).then((opening) => {
        console.log('[Opening] API response:', opening);
        if (opening?.ttsBase64) {
          try {
            const arr = new Uint8Array(
              atob(opening.ttsBase64).split('').map(c => c.charCodeAt(0)),
            );
            const blob = new Blob([arr], { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            const ttsAudio = new Audio(url);
            ttsAudio.onended = () => { console.log('[Opening] TTS ended, starting music'); URL.revokeObjectURL(url); doStartPlay(); };
            ttsAudio.onerror = () => { console.log('[Opening] TTS error, starting music'); URL.revokeObjectURL(url); doStartPlay(); };
            ttsAudio.play().then(() => console.log('[Opening] TTS playing')).catch((e) => { console.log('[Opening] TTS play failed:', e); doStartPlay(); });
          } catch (e) { console.log('[Opening] decode error:', e); doStartPlay(); }
        } else {
          console.log('[Opening] No TTS in response, starting music directly');
          doStartPlay();
        }
      }).catch((e) => { console.log('[Opening] API call failed:', e); doStartPlay(); });
      return;
    }

    if (!isPlaying) {
      doStartPlay();
    } else {
      doPause();
    }
  };

  const doStartPlay = () => {
    const gainNode = gainNodeRef.current;
    if (!gainNode || isFadingRef.current) {
      setIsPlaying(true);
      return;
    }
    gainNode.gain.value = 0;
    setIsPlaying(true);
    const targetGain = volume * volume;
    const fadeDuration = 250;
    const startTime = performance.now();
    isFadingRef.current = true;

    const fadeIn = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / fadeDuration, 1);
      if (gainNode) gainNode.gain.value = targetGain * progress;
      if (progress < 1) {
        requestAnimationFrame(fadeIn);
      } else {
        if (gainNode) gainNode.gain.value = targetGain;
        isFadingRef.current = false;
      }
    };
    requestAnimationFrame(fadeIn);
  };

  const doPause = () => {
    const gainNode = gainNodeRef.current;
    if (!gainNode || isFadingRef.current) {
      setIsPlaying(false);
      return;
    }
    const startGain = gainNode.gain.value;
    const fadeDuration = 250;
    const startTime = performance.now();
    isFadingRef.current = true;

    const fadeOut = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / fadeDuration, 1);
      if (gainNode) gainNode.gain.value = startGain * (1 - progress);
      if (progress < 1) {
        requestAnimationFrame(fadeOut);
      } else {
        if (gainNode) gainNode.gain.value = 0;
        setIsPlaying(false);
        isFadingRef.current = false;
      }
    };
    requestAnimationFrame(fadeOut);
  };

  const handleTrackError = () => {
    console.warn('Audio failed to load, skipping:', currentSong?.name);
    nextTrack();
  };

  const updatePositionState = () => {
    const audio = audioRef.current;
    if (!audio || !('setPositionState' in navigator.mediaSession)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration || 0,
        playbackRate: audio.playbackRate,
        position: audio.currentTime,
      });
    } catch {}
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!isSeeking.current) {
      setAudioProgress({ current: audio.currentTime, duration: audio.duration || 0 });
    }

    updatePositionState();

    const remaining = (audio.duration || 0) - audio.currentTime;
    if (remaining <= 10 && remaining > 0 && !prefetchedRef.current && currentSong?.id) {
      prefetchedRef.current = true;
      api.prefetchNext(currentSong.id, volume).then((data) => {
        const urls = [data?.next?.url, ...(data?.upcoming || []).map((u: any) => u.url)].filter(Boolean);
        urls.forEach((url: string) => {
          const preloadAudio = new Audio();
          preloadAudio.preload = 'auto';
          preloadAudio.src = url;
        });
      }).catch(console.error);
    }

    const ct = audio.currentTime;
    let found = '';
    let foundIndex = -1;
    for (let i = lyricLines.length - 1; i >= 0; i--) {
      if (ct >= lyricLines[i].time) {
        found = lyricLines[i].text;
        foundIndex = i;
        break;
      }
    }
    setCurrentLyric(found);
    setCurrentLyricIndex(foundIndex);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setAudioProgress({ current: 0, duration: audioRef.current.duration || 0 });
      updatePositionState();
    }
  };

  const handleSeekStart = () => { isSeeking.current = true; };
  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAudioProgress(prev => ({ ...prev, current: Number(e.target.value) }));
  };
  const handleSeekEnd = () => {
    isSeeking.current = false;
    if (audioRef.current) {
      audioRef.current.currentTime = audioProgress.current;
      updatePositionState();
    }
  };

  const handleSendCaptcha = async () => {
    setLoginStatus('sending');
    try {
      const res = await fetch('http://localhost:3000/api/send-captcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setLoginStatus('code-sent');
        setCountdown(60);
        setLoginStep('code');
      } else {
        setLoginStatus('error');
      }
    } catch {
      setLoginStatus('error');
    }
  };

  const handlePhoneLogin = async () => {
    setLoginStatus('logging-in');
    try {
      const res = await fetch('http://localhost:3000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput, captcha: captchaInput }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        const expiresAt = Date.now() + 30 * 86400000;
        setCookieExpiresAt(expiresAt);
        localStorage.setItem('cookieExpiresAt', expiresAt.toString());
        const nickname = data.nickname || 'User';
        setLoginNickname(nickname);
        setLoggedInUser({ nickname });
        localStorage.setItem('uradio_user', JSON.stringify({ nickname }));
        setLoginStatus('success');
        loadPlaylist();
        setTimeout(() => {
          setIsLoginOpen(false);
          setLoginStatus('idle');
        }, 2000);
      } else {
        setLoginStatus('error');
      }
    } catch {
      setLoginStatus('error');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('http://localhost:3000/api/logout', { method: 'POST' });
    } catch {}
    setLoggedInUser(null);
    setCookieExpiresAt(null);
    localStorage.removeItem('cookieExpiresAt');
    localStorage.removeItem('uradio_user');
    setIsLoginOpen(false);
    setLoginStep('phone');
    setLoginStatus('idle');
    setPhoneInput('');
    setCaptchaInput('');
  };

  const handleSendMessage = async () => {
    const message = chatInput.trim();
    if (!message) return;

    djStreamIdRef.current = null;

    msgCounter.current++;
    const userMessage = {
      id: `user_${msgCounter.current}`,
      role: 'user' as const,
      content: message,
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput('');
    setIsDjTyping(true);

    try {
      await api.postChat(message, volume);
    } catch (error) {
      console.error('Send message failed:', error);
      setIsDjTyping(false);
    }
  };

  const handleClearHistory = async () => {
    await api.clearChatHistory();
    setChatMessages([]);
    setHistoryLoaded(false);
  };

  const handleAddTrack = (song: any) => {
    const newTrack = {
      id: song.id,
      name: song.name,
      artist: song.artist,
      cover: song.cover,
      url: song.url?.startsWith('http') ? song.url : `http://localhost:3000${song.url}`,
    };
    setPlaylist(prev => {
      const nextIndex = currentIndex + 1;
      const updated = [...prev];
      updated.splice(nextIndex, 0, newTrack);
      return updated;
    });
    setCurrentIndex(prev => prev + 1);
    setIsPlaying(true);
  };

  const handleQueueSelect = (index: number) => {
    setCurrentIndex(index);
    setIsPlaying(true);
  };

  const openLoginModal = () => {
    setPhoneInput('');
    setCaptchaInput('');
    setLoginStep('phone');
    setLoginStatus('idle');
    setCountdown(0);
    setIsLoginOpen(true);
  };

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

        {/* Header */}
        <header className="flex justify-between items-center w-full">
          <h1 className="text-display-md text-text-display tracking-tight">Uradio</h1>
          <div className="flex gap-sm">
            <button onClick={() => {
              if (loggedInUser) {
                setIsLoginOpen(true);
                setLoginStep('code');
                setLoginStatus('idle');
              } else {
                openLoginModal();
              }
            }} className="text-label px-md py-xs rounded-full border border-border-visible text-text-secondary hover:text-text-primary hover:border-text-primary transition-colors cursor-pointer active:scale-95">
              {loggedInUser ? loggedInUser.nickname : 'LOGIN'}
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
          currentLyric={currentLyric}
          lyricLines={lyricLines}
          currentLyricIndex={currentLyricIndex}
          showLyrics={showLyrics}
          isPlaying={isPlaying}
          hasCurrentSong={!!currentSong}
          isLoggedIn={!!loggedInUser}
          onToggleLyrics={() => setShowLyrics(prev => !prev)}
          onLoginClick={openLoginModal}
        />

        {/* Player */}
        <PlayerSection
          currentSong={currentSong}
          isPlaying={isPlaying}
          isLoading={isLoading}
          volume={volume}
          audioProgress={audioProgress}
          radioMode={radioMode}
          onPlayPause={handlePlayPause}
          onPrev={crossfadePrev}
          onNext={crossfadeNext}
          onVolumeChange={setVolume}
          onRadioModeToggle={() => setRadioMode(r => !r)}
          onSeekChange={handleSeekChange}
          onSeekStart={handleSeekStart}
          onSeekEnd={handleSeekEnd}
        />

        {/* Hidden audio element */}
        <audio
          ref={audioRef}
          crossOrigin="anonymous"
          onEnded={handleSongEnd}
          onError={handleTrackError}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onWaiting={() => setIsLoading(true)}
          onCanPlay={() => setIsLoading(false)}
          onPlaying={() => setIsLoading(false)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => { if (audioRef.current && !audioRef.current.ended) setIsPlaying(false); }}
          style={{ display: 'none' }}
        />

        {/* Queue */}
        <QueuePanel
          playlist={playlist}
          currentIndex={currentIndex}
          isPlaying={isPlaying}
          isQueueOpen={isQueueOpen}
          onToggle={() => setIsQueueOpen(!isQueueOpen)}
          onSelect={handleQueueSelect}
        />

        {/* Chat */}
        <ChatPanel
          chatMessages={chatMessages}
          isDjTyping={isDjTyping}
          djStreamIdRef={djStreamIdRef}
          chatInput={chatInput}
          playlist={playlist}
          currentIndex={currentIndex}
          historyLoaded={historyLoaded}
          chatContainerRef={chatContainerRef}
          onInputChange={setChatInput}
          onSend={handleSendMessage}
          onClearHistory={handleClearHistory}
          onAddTrack={handleAddTrack}
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

      {/* Login Modal */}
      <LoginModal
        isOpen={isLoginOpen}
        loggedInUser={loggedInUser}
        cookieExpiresAt={cookieExpiresAt}
        timeRemaining={timeRemaining}
        phoneInput={phoneInput}
        captchaInput={captchaInput}
        loginStep={loginStep}
        loginStatus={loginStatus}
        countdown={countdown}
        loginNickname={loginNickname}
        onClose={() => setIsLoginOpen(false)}
        onSendCaptcha={handleSendCaptcha}
        onPhoneLogin={handlePhoneLogin}
        onLogout={handleLogout}
        onPhoneInputChange={setPhoneInput}
        onCaptchaInputChange={setCaptchaInput}
        onLoginStepChange={setLoginStep}
      />
    </div>
  );
}

export default App;
