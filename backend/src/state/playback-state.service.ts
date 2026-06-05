import { Injectable, Logger } from '@nestjs/common';

export type PlaybackAction = 'play' | 'pause' | 'ended' | 'next' | 'prev';
export type ContentType = 'song' | 'tts';
export type RepeatMode = 'off' | 'one' | 'all';

export interface PlaybackContent {
  type: ContentType;
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration: number;
  coverUrl?: string;
  url?: string;
  lyrics?: { line: string; time: number }[];
}

export interface PlaybackState {
  action: PlaybackAction;
  content: PlaybackContent | null;
  position: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  playlist: PlaybackContent[];
  currentIndex: number;
  queue: {
    next: string[];
    history: string[];
  };
}

@Injectable()
export class PlaybackStateService {
  private readonly logger = new Logger(PlaybackStateService.name);
  private state: PlaybackState = {
    action: 'pause',
    content: null,
    position: 0,
    volume: 80,
    shuffle: false,
    repeat: 'off',
    playlist: [],
    currentIndex: 0,
    queue: { next: [], history: [] },
  };
  private lastUpdate = Date.now();

  getState(): PlaybackState {
    // 根据时间估算当前位置
    if (this.state.action === 'play' && this.state.content) {
      const elapsed = (Date.now() - this.lastUpdate) / 1000;
      this.state.position = Math.min(
        this.state.position + elapsed,
        this.state.content.duration,
      );
      this.lastUpdate = Date.now();
    }
    return { ...this.state };
  }

  updateState(update: Partial<PlaybackState>) {
    Object.assign(this.state, update);
    this.lastUpdate = Date.now();
    this.logger.debug(`Playback state updated: ${JSON.stringify(update)}`);
  }

  setPlaying(content: PlaybackContent) {
    this.state.action = 'play';
    this.state.content = content;
    this.state.position = 0;
    this.lastUpdate = Date.now();
  }

  setPaused() {
    if (this.state.action === 'play') {
      this.state.position = this.getState().position; // 确保位置已同步
    }
    this.state.action = 'pause';
    this.lastUpdate = Date.now();
  }

  nextTrack(): PlaybackContent | null {
    if (this.state.content) {
      this.state.queue.history.push(this.state.content.id);
    }
    // 优先使用 playlist 导航
    if (this.state.playlist.length > 0) {
      const nextIndex = this.state.currentIndex + 1;
      if (nextIndex >= this.state.playlist.length) {
        if (this.state.repeat === 'all') {
          this.state.currentIndex = 0;
        } else {
          this.state.action = 'ended';
          this.state.content = null;
          this.state.position = 0;
          return null;
        }
      } else {
        this.state.currentIndex = nextIndex;
      }
      this.state.content = this.state.playlist[this.state.currentIndex];
      this.state.position = 0;
      this.lastUpdate = Date.now();
      return this.state.content;
    }
    // fallback 到 queue
    const nextId = this.state.queue.next.shift();
    if (!nextId) {
      this.state.action = 'ended';
      this.state.content = null;
      this.state.position = 0;
      return null;
    }
    this.state.position = 0;
    this.lastUpdate = Date.now();
    return this.state.content;
  }

  addToQueue(songIds: string[]) {
    this.state.queue.next.push(...songIds);
  }

  prevTrack(): PlaybackContent | null {
    if (this.state.playlist.length > 0) {
      const prevIndex = this.state.currentIndex - 1;
      if (prevIndex < 0) {
        if (this.state.repeat === 'all') {
          this.state.currentIndex = this.state.playlist.length - 1;
        } else {
          return this.state.content;
        }
      } else {
        this.state.currentIndex = prevIndex;
      }
      this.state.content = this.state.playlist[this.state.currentIndex];
      this.state.position = 0;
      this.lastUpdate = Date.now();
      return this.state.content;
    }
    return this.state.content;
  }

  setPlaylist(tracks: PlaybackContent[]) {
    this.state.playlist = tracks;
    this.state.currentIndex = 0;
    if (tracks.length > 0) {
      this.state.content = tracks[0];
    }
    this.lastUpdate = Date.now();
  }

  addToPlaylist(tracks: PlaybackContent[]) {
    this.state.playlist.push(...tracks);
    this.lastUpdate = Date.now();
  }

  removeFromPlaylist(index: number): boolean {
    if (index < 0 || index >= this.state.playlist.length) return false;
    this.state.playlist.splice(index, 1);
    if (index < this.state.currentIndex) {
      this.state.currentIndex = Math.max(0, this.state.currentIndex - 1);
    } else if (index === this.state.currentIndex) {
      this.state.currentIndex = Math.min(this.state.currentIndex, this.state.playlist.length - 1);
      if (this.state.playlist.length > 0) {
        this.state.content = this.state.playlist[this.state.currentIndex];
      }
    }
    this.lastUpdate = Date.now();
    return true;
  }

  removeFromPlaylistByName(name: string): { removed: boolean; index?: number } {
    const idx = this.state.playlist.findIndex(t => t.title.includes(name));
    if (idx === -1) return { removed: false };
    this.removeFromPlaylist(idx);
    return { removed: true, index: idx };
  }

  getPlaylist(): PlaybackContent[] {
    return [...this.state.playlist];
  }

  setCurrentIndex(index: number) {
    if (index >= 0 && index < this.state.playlist.length) {
      this.state.currentIndex = index;
      this.state.content = this.state.playlist[index];
      this.state.position = 0;
      this.lastUpdate = Date.now();
    }
  }

  seek(position: number) {
    this.state.position = position;
    this.lastUpdate = Date.now();
  }

  setVolume(volume: number) {
    this.state.volume = Math.max(0, Math.min(100, volume));
  }
}
