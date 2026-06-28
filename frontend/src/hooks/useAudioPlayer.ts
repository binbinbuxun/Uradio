import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import type { RadioMode } from '../api';
import { parseLRC } from '../utils';

interface AudioPlayerState {
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  volume: number;
  audioProgress: { current: number; duration: number };
  currentLyric: string;
  showLyrics: boolean;
  currentSong: any;
  currentLyricIndex: number;
  lyricLines: { time: number; text: string }[];
  radioMode: RadioMode;
  radioToast: string | null;
  errorToast: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  ttsAudioRef: React.RefObject<HTMLAudioElement | null>;
  ttsChunksRef: React.RefObject<Map<number, string[]>>;
  gainNodeRef: React.RefObject<GainNode | null>;
  audioContextRef: React.RefObject<AudioContext | null>;
  isFadingRef: React.RefObject<boolean>;
  openingPlayedRef: React.RefObject<boolean>;
  crossfadeNext: () => void;
  crossfadePrev: () => void;
  handlePlayPause: () => void;
  handleSongEnd: () => Promise<void>;
  handleTrackError: () => void;
  handleTimeUpdate: () => void;
  handleLoadedMetadata: () => void;
  handleSeekStart: () => void;
  handleSeekChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSeekEnd: () => void;
  setRadioMode: React.Dispatch<React.SetStateAction<RadioMode>>;
  setShowLyrics: React.Dispatch<React.SetStateAction<boolean>>;
  setVolume: React.Dispatch<React.SetStateAction<number>>;
  setErrorToast: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useAudioPlayer(
  playlist: any[],
  currentIndex: number,
  setCurrentIndex: (i: number | ((prev: number) => number)) => void,
  _setPlaylist: React.Dispatch<React.SetStateAction<any[]>>,
  applyQueueState: (queue?: any) => void,
): AudioPlayerState {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [volume, setVolume] = useState(0.3);
  const [audioProgress, setAudioProgress] = useState({ current: 0, duration: 0 });
  const [currentLyric, setCurrentLyric] = useState('');
  const [showLyrics, setShowLyrics] = useState(false);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [lyricLines, setLyricLines] = useState<{ time: number; text: string }[]>([]);
  const [radioMode, setRadioMode] = useState<RadioMode>(() => {
    const stored = localStorage.getItem('uradio_radio_mode');
    if (stored === 'manual' || stored === 'auto') {
      return stored;
    }
    if (stored === 'assist' || stored === 'true') return 'auto';
    if (stored === 'false') return 'manual';
    return 'auto';
  });
  const [radioToast, setRadioToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsChunksRef = useRef<Map<number, string[]>>(new Map());
  const isSeeking = useRef(false);
  const prefetchedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const isFadingRef = useRef(false);
  const audioChainInitRef = useRef(false);
  const openingPlayedRef = useRef(false);
  const radioModeMountedRef = useRef(false);

  const currentSong = playlist.length > 0 ? playlist[currentIndex] : null;
  const toAbsoluteAudioUrl = (url: string) => url.startsWith('http') ? url : 'http://localhost:3000' + url;
  const radioFeedEnabled = radioMode === 'auto';
  const radioVoiceEnabled = radioMode === 'auto';

  const playTtsWithDucking = useCallback(async (ttsBase64: string) => {
    const arr = new Uint8Array(
      atob(ttsBase64).split('').map((char) => char.charCodeAt(0)),
    );
    const blob = new Blob([arr], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const ttsAudio = new Audio(url);
    const gainNode = gainNodeRef.current;
    const previousGain = gainNode?.gain.value;

    if (gainNode && typeof previousGain === 'number') {
      gainNode.gain.value = previousGain * 0.2;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (gainNode && typeof previousGain === 'number') {
          gainNode.gain.value = previousGain;
        }
        URL.revokeObjectURL(url);
        resolve();
      };

      ttsAudio.onended = cleanup;
      ttsAudio.onerror = cleanup;
      ttsAudio.play().catch(cleanup);
    });
  }, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [isPlaying, currentSong]);

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

  // Persist radio mode
  useEffect(() => {
    localStorage.setItem('uradio_radio_mode', radioMode);
    if (!radioModeMountedRef.current) {
      radioModeMountedRef.current = true;
      return;
    }
    const modeLabel = radioMode === 'manual'
      ? 'MANUAL QUEUE'
      : 'AUTO RADIO';
    setRadioToast(modeLabel);
    const t = setTimeout(() => setRadioToast(null), 2000);
    return () => clearTimeout(t);
  }, [radioMode]);

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

  // Navigation callbacks
  const nextTrack = useCallback(() => {
    if (playlist.length === 0) return;
    const nextIndex = (currentIndex + 1) % playlist.length;
    setCurrentIndex(nextIndex);
    setIsPlaying(true);
    api.selectQueueTrack(nextIndex)
      .then((result) => {
        if (result.queue) applyQueueState(result.queue);
      })
      .catch(console.error);
  }, [playlist.length, currentIndex, setCurrentIndex, applyQueueState]);

  const handleSongEnd = useCallback(async () => {
    if (playlist.length === 0) return;

    if (radioVoiceEnabled) {
      try {
        let segue = await api.getSegueNext();
        if ((!segue?.ttsBase64 || !segue.text) && currentSong?.id) {
          await api.prefetchNext(currentSong.id, volume).catch(() => null);
          segue = await api.getSegueNext();
        }
        if (segue?.ttsBase64 && segue.text) {
          await playTtsWithDucking(segue.ttsBase64);

          if (segue.type === 'recommendation' && segue.recommendedSongs?.length) {
            const queue = await api.getQueue();
            applyQueueState(queue);
          }
        }
      } catch {
        // segue failed, just skip
      }
    }

    const nextIndex = (currentIndex + 1) % playlist.length;
    setCurrentIndex(nextIndex);
    setIsPlaying(true);
    api.selectQueueTrack(nextIndex)
      .then((result) => {
        if (result.queue) applyQueueState(result.queue);
      })
      .catch(console.error);
  }, [playlist.length, currentIndex, radioVoiceEnabled, setCurrentIndex, applyQueueState, currentSong?.id, volume, playTtsWithDucking]);

  const prevTrack = useCallback(() => {
    if (playlist.length === 0) return;
    const nextIndex = (currentIndex - 1 + playlist.length) % playlist.length;
    setCurrentIndex(nextIndex);
    setIsPlaying(true);
    api.selectQueueTrack(nextIndex)
      .then((result) => {
        if (result.queue) applyQueueState(result.queue);
      })
      .catch(console.error);
  }, [playlist.length, currentIndex, setCurrentIndex, applyQueueState]);

  // Crossfade
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

  // Play/Pause with opening
  const handlePlayPause = () => {
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }

    if (!isPlaying && radioVoiceEnabled && !openingPlayedRef.current && currentSong) {
      console.log('[Opening] Fetching opening TTS... volume=', volume);
      api.getOpening(volume).then((opening) => {
        console.log('[Opening] API response:', opening);
        if (opening?.ttsBase64) {
          openingPlayedRef.current = true;
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
    if (remaining <= 10 && remaining > 0 && !prefetchedRef.current && currentSong?.id && radioFeedEnabled) {
      prefetchedRef.current = true;
      api.prefetchNext(currentSong.id, volume).then((data) => {
        const urls = [data?.next?.url, ...(data?.upcoming || []).map((u: any) => u.url)].filter(Boolean);
        urls.forEach((url: string) => {
          const preloadAudio = new Audio();
          preloadAudio.preload = 'auto';
          preloadAudio.src = toAbsoluteAudioUrl(url);
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

  return {
    isPlaying,
    setIsPlaying,
    isLoading,
    setIsLoading,
    volume,
    audioProgress,
    currentLyric,
    showLyrics,
    currentLyricIndex,
    lyricLines,
    radioMode,
    radioToast,
    errorToast,
    audioRef,
    ttsAudioRef,
    ttsChunksRef,
    gainNodeRef,
    audioContextRef,
    isFadingRef,
    openingPlayedRef,
    currentSong,
    crossfadeNext,
    crossfadePrev,
    handlePlayPause,
    handleSongEnd,
    handleTrackError,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleSeekStart,
    handleSeekChange,
    handleSeekEnd,
    setRadioMode,
    setShowLyrics,
    setVolume,
    setErrorToast,
  };
}












