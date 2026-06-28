import { Injectable, Logger } from '@nestjs/common';

export type PlaybackAction = 'play' | 'pause' | 'ended' | 'next' | 'prev';
export type ContentType = 'song' | 'tts';
export type RepeatMode = 'off' | 'one' | 'all';
export type QueueSource = 'bootstrap' | 'manual' | 'dj_chat' | 'radio_auto' | 'restore';
export type QueueOperator = 'user' | 'system' | 'dj';
export type InsertPolicy = 'play_now' | 'play_next' | 'append' | 'manual_position';
export type CandidateSource = 'chat' | 'radio_auto' | 'search';
export type QueueItemStatus = 'queued' | 'playing' | 'played' | 'skipped' | 'removed';

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

export interface QueueTrack extends PlaybackContent {
  queueItemId: string;
  source: QueueSource;
  reason?: string;
  operator: QueueOperator;
  insertedAt: number;
  insertPolicy: InsertPolicy;
  status: QueueItemStatus;
}

export interface QueueCandidate {
  candidateId: string;
  source: CandidateSource;
  track: QueueTrack;
  createdAt: number;
  reason?: string;
}

export interface QueueHistoryItem {
  queueItemId: string;
  trackId: string;
  title: string;
  artist?: string;
  coverUrl?: string;
  playedAt: number;
  source: QueueSource;
  status: Extract<QueueItemStatus, 'played' | 'skipped' | 'removed'>;
}

export interface BootstrapState {
  source: QueueSource;
  label: string;
  initializedAt: number;
  reservoir: QueueTrack[];
}

export interface PlaybackState {
  action: PlaybackAction;
  content: PlaybackContent | null;
  position: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  playlist: QueueTrack[];
  currentIndex: number;
  queue: {
    next: string[];
    history: string[];
  };
  queueId: string;
  queueVersion: number;
  bootstrap: BootstrapState | null;
  candidates: {
    chat: QueueCandidate[];
    radio: QueueCandidate[];
    search: QueueCandidate[];
  };
  history: QueueHistoryItem[];
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
    queueId: this.generateId('queue'),
    queueVersion: 0,
    bootstrap: null,
    candidates: { chat: [], radio: [], search: [] },
    history: [],
  };
  private lastUpdate = Date.now();

  getState(): PlaybackState {
    if (this.state.action === 'play' && this.state.content) {
      const elapsed = (Date.now() - this.lastUpdate) / 1000;
      this.state.position = Math.min(
        this.state.position + elapsed,
        this.state.content.duration,
      );
      this.lastUpdate = Date.now();
    }

    return {
      ...this.state,
      playlist: this.state.playlist.map((track) => ({ ...track })),
      queue: {
        next: [...this.state.queue.next],
        history: [...this.state.queue.history],
      },
      bootstrap: this.state.bootstrap
        ? {
          ...this.state.bootstrap,
          reservoir: this.state.bootstrap.reservoir.map((track) => ({ ...track })),
        }
        : null,
      candidates: {
        chat: this.state.candidates.chat.map((candidate) => this.cloneCandidate(candidate)),
        radio: this.state.candidates.radio.map((candidate) => this.cloneCandidate(candidate)),
        search: this.state.candidates.search.map((candidate) => this.cloneCandidate(candidate)),
      },
      history: this.state.history.map((item) => ({ ...item })),
    };
  }

  getClientQueueSnapshot() {
    const state = this.getState();
    const playlist = state.playlist.map((track) => this.serializeQueueTrack(track));

    return {
      queueId: state.queueId,
      version: state.queueVersion,
      action: state.action,
      currentIndex: state.currentIndex,
      currentTrackId: state.content?.id || null,
      playlist,
      upNext: playlist.slice(state.currentIndex + 1, state.currentIndex + 4),
      bootstrap: state.bootstrap
        ? {
          source: state.bootstrap.source,
          label: state.bootstrap.label,
          reservoirCount: state.bootstrap.reservoir.length,
          initializedAt: state.bootstrap.initializedAt,
        }
        : null,
      candidates: {
        chat: state.candidates.chat.map((candidate) => this.serializeCandidate(candidate)),
        radio: state.candidates.radio.map((candidate) => this.serializeCandidate(candidate)),
        search: state.candidates.search.map((candidate) => this.serializeCandidate(candidate)),
      },
      historyCount: state.history.length,
    };
  }

  updateState(update: Partial<PlaybackState>) {
    Object.assign(this.state, update);
    if (update.currentIndex !== undefined || update.playlist !== undefined || update.action !== undefined) {
      this.syncCurrentContent();
    }
    this.bumpVersion();
    this.lastUpdate = Date.now();
    this.logger.debug(`Playback state updated: ${JSON.stringify(update)}`);
  }

  setPlaying(content: PlaybackContent) {
    const queueItem = this.state.playlist.find((track) => track.id === content.id) || this.toQueueTrack(content, {
      source: 'manual',
      operator: 'system',
      insertPolicy: 'play_now',
    });
    this.state.action = 'play';
    this.state.content = queueItem;
    this.state.position = 0;
    const idx = this.state.playlist.findIndex((track) => track.queueItemId === queueItem.queueItemId);
    if (idx >= 0) {
      this.state.currentIndex = idx;
    }
    this.syncCurrentContent();
    this.bumpVersion();
    this.lastUpdate = Date.now();
  }

  setPaused() {
    if (this.state.action === 'play') {
      this.state.position = this.getState().position;
    }
    this.state.action = 'pause';
    this.syncCurrentContent();
    this.bumpVersion();
    this.lastUpdate = Date.now();
  }

  initializeQueue(
    initialTracks: PlaybackContent[],
    options?: {
      source?: QueueSource;
      label?: string;
      reservoir?: PlaybackContent[];
    },
  ) {
    const source = options?.source || 'bootstrap';
    const label = options?.label || '默认启动';
    this.state.queueId = this.generateId('queue');
    this.state.playlist = initialTracks.map((track, index) => this.toQueueTrack(track, {
      source,
      operator: source === 'manual' ? 'user' : 'system',
      insertPolicy: index === 0 ? 'play_now' : 'append',
    }));
    this.state.currentIndex = 0;
    this.state.position = 0;
    this.state.action = this.state.playlist.length > 0 ? 'pause' : 'ended';
    this.state.bootstrap = {
      source,
      label,
      initializedAt: Date.now(),
      reservoir: (options?.reservoir || []).map((track) => this.toQueueTrack(track, {
        source,
        operator: 'system',
        insertPolicy: 'append',
      })),
    };
    this.state.candidates = { chat: [], radio: [], search: [] };
    this.state.history = [];
    this.state.queue.history = [];
    this.syncCurrentContent();
    this.bumpVersion();
    this.lastUpdate = Date.now();
  }

  nextTrack(): PlaybackContent | null {
    const current = this.state.playlist[this.state.currentIndex];
    if (current) {
      this.recordHistory(current, 'played');
      current.status = 'played';
      this.state.queue.history.push(current.id);
    }

    if (this.state.playlist.length > 0) {
      const nextIndex = this.state.currentIndex + 1;
      if (nextIndex >= this.state.playlist.length) {
        if (this.state.repeat === 'all' && this.state.playlist.length > 0) {
          this.state.currentIndex = 0;
        } else {
          this.state.action = 'ended';
          this.state.content = null;
          this.state.position = 0;
          this.bumpVersion();
          return null;
        }
      } else {
        this.state.currentIndex = nextIndex;
      }
      this.state.position = 0;
      this.syncCurrentContent();
      this.bumpVersion();
      this.lastUpdate = Date.now();
      return this.state.content;
    }

    const nextId = this.state.queue.next.shift();
    if (!nextId) {
      this.state.action = 'ended';
      this.state.content = null;
      this.state.position = 0;
      this.bumpVersion();
      return null;
    }

    this.state.position = 0;
    this.lastUpdate = Date.now();
    this.bumpVersion();
    return this.state.content;
  }

  addToQueue(songIds: string[]) {
    this.state.queue.next.push(...songIds);
    this.bumpVersion();
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
      this.state.position = 0;
      this.syncCurrentContent();
      this.bumpVersion();
      this.lastUpdate = Date.now();
      return this.state.content;
    }
    return this.state.content;
  }

  setPlaylist(tracks: PlaybackContent[]) {
    this.initializeQueue(tracks, { source: 'bootstrap', label: '默认启动' });
  }

  addToPlaylist(
    tracks: PlaybackContent[],
    insertAt?: number,
    options?: {
      source?: QueueSource;
      operator?: QueueOperator;
      insertPolicy?: InsertPolicy;
      reason?: string;
    },
  ) {
    if (tracks.length === 0) return;

    const source = options?.source || 'manual';
    const operator = options?.operator || (source === 'manual' ? 'user' : 'system');
    const insertPolicy = options?.insertPolicy
      || (typeof insertAt === 'number' ? 'manual_position' : 'append');
    const queueTracks = tracks.map((track) => this.toQueueTrack(track, {
      source,
      operator,
      insertPolicy,
      reason: options?.reason,
    }));

    if (typeof insertAt === 'number') {
      const safeIndex = Math.max(0, Math.min(insertAt, this.state.playlist.length));
      this.state.playlist.splice(safeIndex, 0, ...queueTracks);
      if (safeIndex <= this.state.currentIndex && this.state.playlist.length > queueTracks.length) {
        this.state.currentIndex += queueTracks.length;
      }
    } else {
      this.state.playlist.push(...queueTracks);
    }

    if (!this.state.content && this.state.playlist.length > 0) {
      this.state.currentIndex = Math.max(0, Math.min(this.state.currentIndex, this.state.playlist.length - 1));
    }

    this.syncCurrentContent();
    this.bumpVersion();
    this.lastUpdate = Date.now();
  }

  removeFromPlaylist(index: number): boolean {
    if (index < 0 || index >= this.state.playlist.length) return false;

    const [removed] = this.state.playlist.splice(index, 1);
    if (removed) {
      removed.status = 'removed';
      this.recordHistory(removed, 'removed');
    }

    if (index < this.state.currentIndex) {
      this.state.currentIndex = Math.max(0, this.state.currentIndex - 1);
    } else if (index === this.state.currentIndex) {
      this.state.currentIndex = Math.min(this.state.currentIndex, this.state.playlist.length - 1);
      this.state.position = 0;
      if (this.state.playlist.length === 0) {
        this.state.action = 'ended';
      }
    }

    this.syncCurrentContent();
    this.bumpVersion();
    this.lastUpdate = Date.now();
    return true;
  }

  clearUpcoming(): boolean {
    if (this.state.playlist.length <= this.state.currentIndex + 1) return false;
    const removed = this.state.playlist.splice(this.state.currentIndex + 1);
    removed.forEach((track) => {
      track.status = 'removed';
      this.recordHistory(track, 'removed');
    });
    this.bumpVersion();
    this.lastUpdate = Date.now();
    return removed.length > 0;
  }

  moveTrack(fromIndex: number, toIndex: number): boolean {
    if (
      fromIndex <= this.state.currentIndex
      || toIndex <= this.state.currentIndex
      || fromIndex >= this.state.playlist.length
      || toIndex >= this.state.playlist.length
      || fromIndex < 0
      || toIndex < 0
      || fromIndex === toIndex
    ) {
      return false;
    }

    const [moved] = this.state.playlist.splice(fromIndex, 1);
    if (!moved) return false;
    this.state.playlist.splice(toIndex, 0, moved);
    this.syncCurrentContent();
    this.bumpVersion();
    this.lastUpdate = Date.now();
    return true;
  }

  removeFromPlaylistByName(name: string): { removed: boolean; index?: number } {
    const idx = this.state.playlist.findIndex((track) => track.title.includes(name));
    if (idx === -1) return { removed: false };
    this.removeFromPlaylist(idx);
    return { removed: true, index: idx };
  }

  getPlaylist(): QueueTrack[] {
    return this.state.playlist.map((track) => ({ ...track }));
  }

  setCurrentIndex(index: number) {
    if (index >= 0 && index < this.state.playlist.length) {
      this.state.currentIndex = index;
      this.state.position = 0;
      this.syncCurrentContent();
      this.bumpVersion();
      this.lastUpdate = Date.now();
    }
  }

  addCandidates(
    source: CandidateSource,
    tracks: PlaybackContent[],
    options?: { reason?: string },
  ): QueueCandidate[] {
    const bucket = this.getCandidateBucket(source);
    const existingKeys = new Set(
      [
        ...this.state.candidates.chat.map((candidate) => candidate.track.id),
        ...this.state.candidates.radio.map((candidate) => candidate.track.id),
        ...this.state.candidates.search.map((candidate) => candidate.track.id),
      ],
    );

    const created: QueueCandidate[] = [];
    for (const track of tracks) {
      if (!track?.id || existingKeys.has(track.id)) continue;
      const queueTrack = this.toQueueTrack(track, {
        source: source === 'chat' ? 'dj_chat' : source === 'radio_auto' ? 'radio_auto' : 'manual',
        operator: source === 'chat' ? 'dj' : 'system',
        insertPolicy: 'append',
        reason: options?.reason,
      });
      const candidate: QueueCandidate = {
        candidateId: this.generateId('candidate'),
        source,
        track: queueTrack,
        createdAt: Date.now(),
        reason: options?.reason,
      };
      bucket.push(candidate);
      existingKeys.add(track.id);
      created.push(this.cloneCandidate(candidate));
    }

    if (created.length > 0) {
      this.bumpVersion();
      this.lastUpdate = Date.now();
    }

    return created;
  }

  acceptCandidate(
    candidateId: string,
    mode: 'play_now' | 'play_next' | 'append' = 'append',
  ): QueueTrack | null {
    const resolved = this.extractCandidate(candidateId);
    if (!resolved) return null;

    const insertAt = mode === 'append'
      ? this.state.playlist.length
      : this.state.currentIndex + 1;

    this.addToPlaylist([resolved.candidate.track], insertAt, {
      source: resolved.candidate.track.source,
      operator: 'user',
      insertPolicy: mode,
      reason: resolved.candidate.reason,
    });

    if (mode === 'play_now') {
      this.setCurrentIndex(insertAt);
      this.state.action = 'play';
      this.syncCurrentContent();
      this.bumpVersion();
    }

    const accepted = this.state.playlist[insertAt];
    return accepted ? { ...accepted } : null;
  }

  rejectCandidate(candidateId: string): boolean {
    return !!this.extractCandidate(candidateId);
  }

  seek(position: number) {
    this.state.position = position;
    this.lastUpdate = Date.now();
  }

  setVolume(volume: number) {
    this.state.volume = Math.max(0, Math.min(100, volume));
  }

  ensureBootstrapUpcoming(minUpcoming = 3, batchSize = 4): QueueTrack[] {
    const upcomingCount = Math.max(this.state.playlist.length - this.state.currentIndex - 1, 0);
    const reservoir = this.state.bootstrap?.reservoir;
    if (!reservoir || reservoir.length === 0 || upcomingCount >= minUpcoming) {
      return [];
    }

    const takeCount = Math.min(
      reservoir.length,
      Math.max(minUpcoming - upcomingCount, 1),
      batchSize,
    );
    const replenished = reservoir.splice(0, takeCount).map((track) => ({ ...track }));
    this.addToPlaylist(replenished, this.state.playlist.length, {
      source: 'bootstrap',
      operator: 'system',
      insertPolicy: 'append',
    });
    return replenished;
  }

  private extractCandidate(candidateId: string) {
    const buckets = [
      this.state.candidates.chat,
      this.state.candidates.radio,
      this.state.candidates.search,
    ];

    for (const bucket of buckets) {
      const idx = bucket.findIndex((candidate) => candidate.candidateId === candidateId);
      if (idx >= 0) {
        const [candidate] = bucket.splice(idx, 1);
        this.bumpVersion();
        this.lastUpdate = Date.now();
        return { candidate, bucket };
      }
    }

    return null;
  }

  private getCandidateBucket(source: CandidateSource) {
    if (source === 'radio_auto') return this.state.candidates.radio;
    if (source === 'search') return this.state.candidates.search;
    return this.state.candidates.chat;
  }

  private syncCurrentContent() {
    const current = this.state.playlist[this.state.currentIndex] || null;
    this.state.content = current;

    this.state.playlist.forEach((track, index) => {
      if (track.status === 'removed') return;
      if (index < this.state.currentIndex && track.status === 'queued') {
        track.status = 'played';
      } else if (index === this.state.currentIndex && current) {
        track.status = 'playing';
      } else if (index > this.state.currentIndex) {
        track.status = 'queued';
      }
    });
  }

  private recordHistory(
    track: QueueTrack,
    status: Extract<QueueItemStatus, 'played' | 'skipped' | 'removed'>,
  ) {
    this.state.history.unshift({
      queueItemId: track.queueItemId,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      coverUrl: track.coverUrl,
      playedAt: Date.now(),
      source: track.source,
      status,
    });
    this.state.history = this.state.history.slice(0, 100);
  }

  private toQueueTrack(
    track: PlaybackContent,
    options: {
      source: QueueSource;
      operator: QueueOperator;
      insertPolicy: InsertPolicy;
      reason?: string;
    },
  ): QueueTrack {
    const existing = track as Partial<QueueTrack>;
    return {
      type: track.type,
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      coverUrl: track.coverUrl,
      url: track.url,
      lyrics: track.lyrics,
      queueItemId: existing.queueItemId || this.generateId('queue_item'),
      source: existing.source || options.source,
      reason: options.reason || existing.reason,
      operator: options.operator,
      insertedAt: existing.insertedAt || Date.now(),
      insertPolicy: existing.insertPolicy || options.insertPolicy,
      status: existing.status || 'queued',
    };
  }

  private serializeQueueTrack(track: QueueTrack) {
    return {
      id: track.id,
      queueItemId: track.queueItemId,
      name: track.title,
      title: track.title,
      artist: track.artist || '',
      cover: track.coverUrl || '',
      coverUrl: track.coverUrl || '',
      url: track.url || `/audio/${track.id}`,
      source: track.source,
      reason: track.reason,
      status: track.status,
      insertPolicy: track.insertPolicy,
    };
  }

  private serializeCandidate(candidate: QueueCandidate) {
    const track = this.serializeQueueTrack(candidate.track);
    return {
      ...track,
      candidateId: candidate.candidateId,
      source: candidate.source,
      reason: candidate.reason || track.reason,
      createdAt: candidate.createdAt,
    };
  }

  private cloneCandidate(candidate: QueueCandidate): QueueCandidate {
    return {
      ...candidate,
      track: { ...candidate.track },
    };
  }

  private bumpVersion() {
    this.state.queueVersion += 1;
  }

  private generateId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
