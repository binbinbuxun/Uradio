import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TtsService } from './tts.service';
import { MusicService } from '../music/music.service';
import { ChatMessage } from '../chat/chat-message.entity';
import { ChatGateway } from '../chat/chat.gateway';
import { SegueEngineService } from './segue-engine.service';
import { PlaybackContent } from '../state/playback-state.service';
import { LlmService } from '../llm/llm.service';

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
  private playCount = 0;
  private nextRecommendationAt: number;

  constructor(
    private readonly ttsService: TtsService,
    private readonly musicService: MusicService,
    private readonly llmService: LlmService,
    private readonly segueEngine: SegueEngineService,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepo: Repository<ChatMessage>,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {
    this.nextRecommendationAt = this.randomThreshold();
  }

  private randomThreshold(): number {
    return 5 + Math.floor(Math.random() * 6);
  }

  private toResultTrack(track: PlaybackContent) {
    return {
      songId: track.id.toString(),
      title: track.title,
      artist: track.artist || 'Î´Öª¸èÊÖ',
      url: track.url || `/audio/${track.id}`,
      duration: track.duration || 0,
    };
  }

  async generateOpening(clientVolume = 0.5): Promise<CachedSegue | null> {
    this.logger.log('Generating opening monologue');

    const slotContext = this.segueEngine.getSlotContext();

    try {
      const result = await this.llmService.generateOpening(slotContext);
      if (!result?.say) return null;

      const ttsBase64 = await this.synthesizeBase64(result.say, clientVolume);
      const opening: CachedSegue = {
        text: result.say,
        ttsBase64,
        songTitle: '',
        artist: '',
        createdAt: Date.now(),
        type: 'opening',
      };

      this.saveSegueToChatHistory(result.say, 'opening').catch(
        (e) => this.logger.warn(`Failed to save opening to chat history: ${e}`),
      );
      this.chatGateway.broadcastSegue({
        type: 'opening',
        text: result.say,
        source: 'radio_auto',
      });

      return opening;
    } catch (error) {
      this.logger.warn(`Failed to generate opening: ${error}`);
      return null;
    }
  }

  async prefetchNext(currentSongId: string, clientVolume = 0.5): Promise<PrefetchResult> {
    this.logger.log(`Prefetching next song after ${currentSongId} (playCount=${this.playCount}, recAt=${this.nextRecommendationAt})`);

    const trackWindow = this.segueEngine.resolveTrackWindow(currentSongId, 3);
    if (!trackWindow?.next) {
      throw new Error('No upcoming songs available');
    }

    const { current, next, upcoming } = trackWindow;
    this.playCount++;

    if (this.playCount >= this.nextRecommendationAt) {
      const recommendation = await this.generateRecommendationBreak(next, clientVolume);
      this.playCount = 0;
      this.nextRecommendationAt = this.randomThreshold();
      if (recommendation) {
        return {
          next: this.toResultTrack(next),
          upcoming: upcoming.slice(1).map((track) => this.toResultTrack(track)),
          segue: recommendation,
        };
      }
    }

    let segue: PrefetchResult['segue'] = null;
    try {
      const segueText = await this.segueEngine.generateSegue(current, next);
      if (segueText) {
        const ttsBase64 = await this.synthesizeBase64(segueText, clientVolume);
        this.pendingSegue = {
          text: segueText,
          ttsBase64,
          songTitle: next.title,
          artist: next.artist || '',
          createdAt: Date.now(),
          type: 'segue',
        };

        this.saveSegueToChatHistory(segueText, 'segue', next.title, next.artist || '').catch(
          (e) => this.logger.warn(`Failed to save segue to chat history: ${e}`),
        );
        this.chatGateway.broadcastSegue({
          type: 'segue',
          text: segueText,
          songTitle: next.title,
          artist: next.artist || '',
          source: 'radio_auto',
        });

        const audioUrl = `/api/tts?text=${encodeURIComponent(segueText)}&voice=zh-CN-XiaoxiaoNeural`;
        segue = { text: segueText, audioUrl, type: 'segue' };
      }
    } catch (error) {
      this.logger.warn(`Failed to generate segue TTS: ${error}`);
    }

    return {
      next: this.toResultTrack(next),
      upcoming: upcoming.slice(1).map((track) => this.toResultTrack(track)),
      segue,
    };
  }

  consumeSegue(): CachedSegue | null {
    const segue = this.pendingSegue;
    this.pendingSegue = null;
    return segue;
  }

  private async generateRecommendationBreak(next: PlaybackContent, clientVolume: number): Promise<PrefetchResult['segue'] | null> {
    this.logger.log(`Recommendation break triggered at playCount=${this.playCount}`);

    try {
      const slotContext = this.segueEngine.getSlotContext();
      const rec = await this.llmService.generateRecommendation([next.title], slotContext);
      if (!rec?.say || !Array.isArray(rec.play) || rec.play.length === 0) {
        return null;
      }

      const recommendedSongs: CachedSegue['recommendedSongs'] = [];
      for (const item of rec.play) {
        const recTitle = (item as any).title || '';
        const recArtist = (item as any).artist || '';
        const keyword = item.keyword || recTitle || '';
        const queries: string[] = [keyword];
        if (recTitle && recArtist) queries.push(`${recTitle} ${recArtist}`);
        if (recTitle) queries.push(recTitle);

        let found = false;
        for (const query of queries) {
          if (found || !query || query.length > 50) continue;
          try {
            const result: any = await this.musicService.searchMusic(query, 3);
            const songs = result?.songs || [];
            const best = recTitle
              ? songs.find((song: any) => song.name?.toLowerCase().includes(recTitle.toLowerCase())) || songs[0]
              : songs[0];
            if (best) {
              recommendedSongs.push({
                id: best.id.toString(),
                name: best.name,
                artist: best.ar?.map((artist: any) => artist.name).join(' / ') || '',
                cover: best.al?.picUrl || '',
                reason: (item as any).reason || '',
              });
              found = true;
            }
          } catch {
            // try next query
          }
        }
      }

      const ttsBase64 = await this.synthesizeBase64(rec.say, clientVolume);
      this.pendingSegue = {
        text: rec.say,
        ttsBase64,
        songTitle: next.title,
        artist: next.artist || '',
        createdAt: Date.now(),
        type: 'recommendation',
        recommendedSongs: recommendedSongs.length > 0 ? recommendedSongs : undefined,
      };

      this.saveSegueToChatHistory(rec.say, 'recommendation', next.title, next.artist || '', recommendedSongs).catch(
        (e) => this.logger.warn(`Failed to save recommendation to chat history: ${e}`),
      );
      this.chatGateway.broadcastSegue({
        type: 'recommendation',
        text: rec.say,
        songTitle: next.title,
        artist: next.artist || '',
        recommendedSongs: recommendedSongs.length > 0 ? recommendedSongs : undefined,
        source: 'radio_auto',
      });

      const audioUrl = `/api/tts?text=${encodeURIComponent(rec.say)}&voice=zh-CN-XiaoxiaoNeural`;
      return {
        text: rec.say,
        audioUrl,
        type: 'recommendation',
        recommendedSongs,
      };
    } catch (error) {
      this.logger.warn(`Failed to generate recommendation: ${error}`);
      return null;
    }
  }

  private async synthesizeBase64(text: string, clientVolume: number): Promise<string> {
    const vol = typeof clientVolume === 'number' ? clientVolume : 0.5;
    const ttsVolume = `${Math.round((vol - 0.5) * 100)}%`;
    const ttsBuffer = await this.ttsService.synthesize({
      text,
      volume: ttsVolume,
    });
    return ttsBuffer.toString('base64');
  }

  private async saveSegueToChatHistory(
    text: string,
    segueType: 'opening' | 'segue' | 'recommendation',
    songTitle?: string,
    artist?: string,
    recommendedSongs?: any[],
  ): Promise<void> {
    const chatId = `segue_${Date.now()}`;
    await this.chatMessageRepo.save(
      this.chatMessageRepo.create({
        chatId,
        role: 'dj',
        content: text,
        metadata: {
          source: 'radio_auto',
          segueType,
          songTitle: songTitle || undefined,
          artist: artist || undefined,
          recommendedSongs: recommendedSongs && recommendedSongs.length > 0 ? recommendedSongs : undefined,
        },
      }),
    );
    this.logger.debug(`Saved ${segueType} to chat history: "${text.substring(0, 30)}..."`);
  }
}



