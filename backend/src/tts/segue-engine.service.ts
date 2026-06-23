import { Injectable, Logger } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { LlmService } from '../llm/llm.service';
import { PlaybackContent, PlaybackStateService } from '../state/playback-state.service';
import { SchedulerService } from '../scheduler/scheduler.service';

export interface SegueTrackWindow {
  current: PlaybackContent;
  currentIndex: number;
  next: PlaybackContent | null;
  upcoming: PlaybackContent[];
}

export interface SegueEvaluation {
  shouldSegue: boolean;
  reason: 'missing-next' | 'same-artist' | 'genre-overlap' | 'eligible';
  currentGenres: string[];
  nextGenres: string[];
}

@Injectable()
export class SegueEngineService {
  private readonly logger = new Logger(SegueEngineService.name);
  private readonly genreCache = new LRUCache<string, string[]>({ max: 1000 });

  constructor(
    private readonly llmService: LlmService,
    private readonly playbackState: PlaybackStateService,
    private readonly schedulerService: SchedulerService,
  ) {}

  getSlotContext(): string {
    const currentHour = new Date().getHours();
    const currentSlot = this.schedulerService.getCurrentSlot(currentHour);
    return currentSlot
      ? `当前时段：${currentSlot.label}（${currentSlot.mood}），推荐曲风：${currentSlot.genres.join('、')}。`
      : '';
  }

  resolveTrackWindow(currentSongId: string, windowSize = 3): SegueTrackWindow | null {
    const state = this.playbackState.getState();
    const playlist = state.playlist || [];
    if (playlist.length === 0) return null;

    let currentIndex = playlist.findIndex((track) => track.id === currentSongId);
    if (currentIndex < 0) {
      currentIndex = state.currentIndex;
    }

    const current = playlist[currentIndex];
    if (!current) return null;

    const upcoming: PlaybackContent[] = [];
    for (let offset = 1; offset <= windowSize; offset++) {
      let candidateIndex = currentIndex + offset;
      if (candidateIndex >= playlist.length) {
        if (state.repeat === 'all') {
          candidateIndex = candidateIndex % playlist.length;
        } else {
          break;
        }
      }

      const candidate = playlist[candidateIndex];
      if (!candidate) break;
      if (candidate.id === current.id && playlist.length === 1) break;
      if (upcoming.some((track) => track.id === candidate.id)) break;
      upcoming.push(candidate);
    }

    return {
      current,
      currentIndex,
      next: upcoming[0] || null,
      upcoming,
    };
  }

  async evaluate(current: PlaybackContent, next: PlaybackContent | null): Promise<SegueEvaluation> {
    if (!next) {
      return { shouldSegue: false, reason: 'missing-next', currentGenres: [], nextGenres: [] };
    }

    if (current.artist && next.artist && current.artist === next.artist) {
      return { shouldSegue: false, reason: 'same-artist', currentGenres: [], nextGenres: [] };
    }

    const [currentGenres, nextGenres] = await Promise.all([
      this.getSongGenres(current),
      this.getSongGenres(next),
    ]);

    if (currentGenres.length > 0 && nextGenres.length > 0 && this.genresOverlap(currentGenres, nextGenres)) {
      return { shouldSegue: false, reason: 'genre-overlap', currentGenres, nextGenres };
    }

    return { shouldSegue: true, reason: 'eligible', currentGenres, nextGenres };
  }

  async generateSegue(current: PlaybackContent, next: PlaybackContent | null): Promise<string | null> {
    const evaluation = await this.evaluate(current, next);
    if (!evaluation.shouldSegue || !next) {
      this.logger.debug(`Skipping segue: ${evaluation.reason}`);
      return null;
    }

    const slotContext = this.getSlotContext();
    return this.llmService.generateSegue(
      current.title,
      current.artist || '',
      next.title,
      next.artist || '',
      slotContext,
    );
  }

  private async getSongGenres(track: PlaybackContent): Promise<string[]> {
    const songId = track.id;
    if (!songId) return [];
    if (this.genreCache.has(songId)) {
      return this.genreCache.get(songId)!;
    }
    const genres = await this.llmService.classifySongGenre(track.title, track.artist || '');
    this.genreCache.set(songId, genres);
    this.logger.debug(`Classified ${track.title}: [${genres.join(', ')}]`);
    return genres;
  }

  private genresOverlap(a: string[], b: string[]): boolean {
    if (a.length === 0 || b.length === 0) return false;
    const setB = new Set(b.map((genre) => genre.toLowerCase()));
    return a.some((genre) => setB.has(genre.toLowerCase()));
  }
}
