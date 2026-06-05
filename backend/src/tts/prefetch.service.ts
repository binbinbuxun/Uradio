import { Injectable, Logger } from '@nestjs/common';
import { TtsService } from './tts.service';
import { MusicService } from '../music/music.service';
import { LlmService } from '../llm/llm.service';
import { PlaybackStateService } from '../state/playback-state.service';
import { SchedulerService } from '../scheduler/scheduler.service';

export interface PrefetchResult {
  next: {
    songId: string;
    title: string;
    artist: string;
    url: string;
    duration: number;
  };
  upcoming: {
    songId: string;
    title: string;
    artist: string;
    url: string;
    duration: number;
  }[];
  segue: {
    text: string;
    audioUrl: string;
    type: 'opening' | 'segue' | 'recommendation';
    recommendedSongs?: {
      id: string;
      name: string;
      artist: string;
      cover: string;
      reason: string;
    }[];
  } | null;
}

export interface CachedSegue {
  text: string;
  ttsBase64: string;
  songTitle: string;
  artist: string;
  createdAt: number;
  type: 'opening' | 'segue' | 'recommendation';
  recommendedSongs?: {
    id: string;
    name: string;
    artist: string;
    cover: string;
    reason: string;
  }[];
}

@Injectable()
export class PrefetchService {
  private readonly logger = new Logger(PrefetchService.name);
  private pendingSegue: CachedSegue | null = null;
  private genreCache = new Map<string, string[]>();
  private playCount = 0;
  private nextRecommendationAt: number;

  constructor(
    private readonly ttsService: TtsService,
    private readonly musicService: MusicService,
    private readonly llmService: LlmService,
    private readonly playbackState: PlaybackStateService,
    private readonly schedulerService: SchedulerService,
  ) {
    this.nextRecommendationAt = this.randomThreshold();
  }

  private randomThreshold(): number {
    return 5 + Math.floor(Math.random() * 6); // 5-10
  }

  private async getSongGenres(songId: string, title: string, artist: string): Promise<string[]> {
    if (this.genreCache.has(songId)) {
      return this.genreCache.get(songId)!;
    }
    const genres = await this.llmService.classifySongGenre(title, artist);
    this.genreCache.set(songId, genres);
    this.logger.debug(`Classified ${title}: [${genres.join(', ')}]`);
    return genres;
  }

  private genresOverlap(a: string[], b: string[]): boolean {
    if (a.length === 0 || b.length === 0) return false;
    const setB = new Set(b.map(g => g.toLowerCase()));
    return a.some(g => setB.has(g.toLowerCase()));
  }

  private getSlotContext(): string {
    const currentHour = new Date().getHours();
    const currentSlot = this.schedulerService.getCurrentSlot(currentHour);
    return currentSlot
      ? `当前时段：${currentSlot.label}（${currentSlot.mood}），推荐曲风：${currentSlot.genres.join('、')}。`
      : '';
  }

  async generateOpening(clientVolume = 0.5): Promise<CachedSegue | null> {
    this.logger.log('Generating opening monologue');

    const slotContext = this.getSlotContext();

    try {
      const result = await this.llmService.generateOpening(slotContext);
      if (!result?.say) return null;

      const vol = typeof clientVolume === 'number' ? clientVolume : 0.5;
      const ttsVolume = `${Math.round((vol - 0.5) * 100)}%`;

      const ttsBuffer = await this.ttsService.synthesize({
        text: result.say,
        volume: ttsVolume,
      });
      const ttsBase64 = ttsBuffer.toString('base64');

      const opening: CachedSegue = {
        text: result.say,
        ttsBase64,
        songTitle: '',
        artist: '',
        createdAt: Date.now(),
        type: 'opening',
      };

      return opening;
    } catch (error) {
      this.logger.warn(`Failed to generate opening: ${error}`);
      return null;
    }
  }

  async prefetchNext(currentSongId: string, clientVolume = 0.5): Promise<PrefetchResult> {
    this.logger.log(`Prefetching next song after ${currentSongId} (playCount=${this.playCount}, recAt=${this.nextRecommendationAt})`);

    // Increment play count for recommendation tracking
    this.playCount++;

    // 1. Get daily recommendation songs
    const recommendData: any = await this.musicService.getRecommendSongs();
    const dailySongs = recommendData?.dailySongs || [];

    if (dailySongs.length === 0) {
      throw new Error('No recommended songs available');
    }

    // 2. Pick next 3 songs (skip current)
    const remaining = dailySongs.filter((s: any) => s.id.toString() !== currentSongId);
    const batchSongs = remaining.slice(0, 3);
    if (batchSongs.length === 0) {
      throw new Error('No upcoming songs available');
    }

    const mapSong = (s: any) => ({
      songId: s.id.toString(),
      title: s.name,
      artist: s.ar?.map((a: any) => a.name).join(' / ') || '未知歌手',
      duration: s.dt ? Math.floor(s.dt / 1000) : 0,
    });

    // Parallel URL fetch for all upcoming songs
    const upcoming = await Promise.all(
      batchSongs.map(async (s: any) => {
        const mapped = mapSong(s);
        try {
          const urlData: any = await this.musicService.getSongUrl(s.id.toString());
          const url = Array.isArray(urlData)
            ? urlData.find((item: any) => item?.url)?.url
            : urlData?.[0]?.url;
          return { ...mapped, url: url ? `/audio/${s.id}` : '' };
        } catch {
          return { ...mapped, url: '' };
        }
      }),
    );

    const next = upcoming[0];
    const songId = next.songId;
    const title = next.title;
    const artist = next.artist;

    // 3. Check if it's time for a recommendation break
    if (this.playCount >= this.nextRecommendationAt) {
      this.logger.log(`Recommendation break triggered at playCount=${this.playCount}`);

      try {
        const slotContext = this.getSlotContext();
        const recentTitles = [title]; // current next song as context

        const rec = await this.llmService.generateRecommendation(recentTitles, slotContext);
        if (rec?.say && rec.play.length > 0) {
          // Search each recommended song
          const recommendedSongs: CachedSegue['recommendedSongs'] = [];
          for (const item of rec.play) {
            const kw = item.keyword || '';
            if (!kw || kw.length > 50) continue;
            try {
              const result: any = await this.musicService.searchMusic(kw, 1);
              const song = result?.songs?.[0];
              if (song) {
                recommendedSongs.push({
                  id: song.id.toString(),
                  name: song.name,
                  artist: song.ar?.map((a: any) => a.name).join(' / ') || '',
                  cover: song.al?.picUrl || '',
                  reason: item.reason || '',
                });
              }
            } catch {
              // skip failed searches
            }
          }

          const vol = typeof clientVolume === 'number' ? clientVolume : 0.5;
          const ttsVolume = `${Math.round((vol - 0.5) * 100)}%`;

          const ttsBuffer = await this.ttsService.synthesize({
            text: rec.say,
            volume: ttsVolume,
          });
          const ttsBase64 = ttsBuffer.toString('base64');

          this.pendingSegue = {
            text: rec.say,
            ttsBase64,
            songTitle: title,
            artist,
            createdAt: Date.now(),
            type: 'recommendation',
            recommendedSongs: recommendedSongs.length > 0 ? recommendedSongs : undefined,
          };

          // Reset counter
          this.playCount = 0;
          this.nextRecommendationAt = this.randomThreshold();

          const audioUrl = `/api/tts?text=${encodeURIComponent(rec.say)}&voice=zh-CN-XiaoxiaoNeural`;
          return {
            next: { ...next, url: `/audio/${songId}` },
            upcoming: upcoming.slice(1).map(u => ({ ...u, url: `/audio/${u.songId}` })),
            segue: {
              text: rec.say,
              audioUrl,
              type: 'recommendation',
              recommendedSongs,
            },
          };
        }
      } catch (error) {
        this.logger.warn(`Failed to generate recommendation: ${error}`);
      }

      // Reset counter even on failure to avoid repeated attempts
      this.playCount = 0;
      this.nextRecommendationAt = this.randomThreshold();
    }

    // 4. Normal segue: only when genres differ
    const currentState = this.playbackState.getState();
    const currentId = currentState.content?.id || '';
    const currentTitle = currentState.content?.title || '';
    const currentArtist = currentState.content?.artist || '';

    // Same artist → skip
    if (currentArtist && artist && currentArtist === artist) {
      this.logger.debug(`Same artist (${currentArtist}), skipping segue`);
      return this.buildResult(next, upcoming, null);
    }

    // Genre comparison
    const [currentGenres, nextGenres] = await Promise.all([
      this.getSongGenres(currentId, currentTitle, currentArtist),
      this.getSongGenres(songId, title, artist),
    ]);

    if (currentGenres.length > 0 && nextGenres.length > 0 && this.genresOverlap(currentGenres, nextGenres)) {
      this.logger.debug(`Genre overlap: [${currentGenres}] ≈ [${nextGenres}], skipping segue`);
      return this.buildResult(next, upcoming, null);
    }

    // Different genres → generate segue
    const slotContext = this.getSlotContext();

    let segue: PrefetchResult['segue'] = null;
    try {
      const segueText = await this.llmService.generateSegue(
        currentTitle, currentArtist, title, artist, slotContext,
      );
      if (segueText) {
        const vol = typeof clientVolume === 'number' ? clientVolume : 0.5;
        const ttsVolume = `${Math.round((vol - 0.5) * 100)}%`;

        const ttsBuffer = await this.ttsService.synthesize({
          text: segueText,
          volume: ttsVolume,
        });
        const ttsBase64 = ttsBuffer.toString('base64');

        this.pendingSegue = {
          text: segueText,
          ttsBase64,
          songTitle: title,
          artist,
          createdAt: Date.now(),
          type: 'segue',
        };

        const audioUrl = `/api/tts?text=${encodeURIComponent(segueText)}&voice=zh-CN-XiaoxiaoNeural`;
        segue = { text: segueText, audioUrl, type: 'segue' };
      }
    } catch (error) {
      this.logger.warn(`Failed to generate segue TTS: ${error}`);
    }

    return this.buildResult(next, upcoming, segue);
  }

  private buildResult(
    next: { songId: string; title: string; artist: string; url: string; duration: number },
    upcoming: { songId: string; title: string; artist: string; url: string; duration: number }[],
    segue: PrefetchResult['segue'],
  ): PrefetchResult {
    return {
      next: { ...next, url: `/audio/${next.songId}` },
      upcoming: upcoming.slice(1).map(u => ({ ...u, url: `/audio/${u.songId}` })),
      segue,
    };
  }

  consumeSegue(): CachedSegue | null {
    const segue = this.pendingSegue;
    this.pendingSegue = null;
    return segue;
  }
}
