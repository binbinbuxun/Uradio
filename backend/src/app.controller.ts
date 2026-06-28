import { Controller, Get, Post, Body, Headers, Param, Res, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { AppService } from './app.service';
import { MusicService } from './music/music.service';
import { StateService } from './state/state.service';
import {
  PlaybackStateService,
  PlaybackContent,
  QueueSource,
  InsertPolicy,
} from './state/playback-state.service';
import { ChatGateway } from './chat/chat.gateway';
import { TasteService } from './user/taste.service';
import type { Response } from 'express';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly musicService: MusicService,
    private readonly stateService: StateService,
    private readonly playbackState: PlaybackStateService,
    private readonly chatGateway: ChatGateway,
    private readonly tasteService: TasteService,
  ) {}

  private toQueueItem(track: PlaybackContent) {
    return {
      id: track.id,
      queueItemId: (track as any).queueItemId,
      name: track.title,
      title: track.title,
      artist: track.artist || '',
      cover: track.coverUrl || '',
      url: track.url || `/audio/${track.id}`,
      source: (track as any).source,
      reason: (track as any).reason,
      status: (track as any).status,
      insertPolicy: (track as any).insertPolicy,
    };
  }

  private toPlaybackTrack(track: any): PlaybackContent {
    return {
      type: 'song',
      id: track.id?.toString() || '',
      title: track.title || track.name || '',
      artist: track.artist || '',
      album: track.album || '',
      duration: track.duration || 0,
      coverUrl: track.coverUrl || track.cover || '',
      url: track.url?.startsWith('http') ? track.url : (track.url || `/audio/${track.id}`),
    };
  }

  private getQueueSnapshot() {
    return this.playbackState.getClientQueueSnapshot();
  }

  private async ensureQueueInitialized() {
    const managedPlaylist = this.playbackState.getPlaylist();
    if (managedPlaylist.length > 0) {
      return this.getQueueSnapshot();
    }

    const recommendData: any = await this.musicService.getRecommendSongs();
    if (!recommendData || !recommendData.dailySongs || recommendData.dailySongs.length === 0) {
      return this.getQueueSnapshot();
    }

    const songs = recommendData.dailySongs.slice(0, 30);
    const tracks = songs.map((song: any) => ({
      type: 'song' as const,
      id: song.id.toString(),
      title: song.name,
      artist: song.ar.map((a: any) => a.name).join(' / '),
      album: song.al?.name || '',
      duration: song.dt ? Math.floor(song.dt / 1000) : 0,
      coverUrl: song.al.picUrl || '',
      url: `/audio/${song.id}`,
    }));
    const initialTracks = tracks.slice(0, 12);
    const reservoir = tracks.slice(12);
    this.playbackState.initializeQueue(initialTracks, {
      source: 'bootstrap',
      label: '今日推荐启动',
      reservoir,
    });
    return this.getQueueSnapshot();
  }

  private async runQueueCommand(payload: {
    command: 'play_now' | 'play_next' | 'append' | 'remove' | 'clear_upcoming' | 'accept_candidate' | 'reject_candidate' | 'move';
    track?: any;
    tracks?: any[];
    candidateId?: string;
    index?: number;
    fromIndex?: number;
    toIndex?: number;
    source?: QueueSource | 'chat';
    reason?: string;
  }) {
    await this.ensureQueueInitialized();

    let broadcastAction: 'add' | 'remove' | 'replace' = 'replace';
    let shouldBroadcastNowPlaying = false;

    switch (payload.command) {
      case 'play_now':
      case 'play_next':
      case 'append': {
        const incoming = Array.isArray(payload.tracks)
          ? payload.tracks
          : payload.track
            ? [payload.track]
            : [];
        if (incoming.length === 0) {
          return { status: 'error', message: 'Track is required' };
        }

        const mappedTracks = incoming.map((item) => this.toPlaybackTrack(item));
        const stateBefore = this.playbackState.getState();
        const insertAt = payload.command === 'append'
          ? stateBefore.playlist.length
          : stateBefore.currentIndex + 1;
        const source = payload.source === 'chat'
          ? 'dj_chat'
          : payload.source || 'manual';
        const insertPolicy: InsertPolicy = payload.command;

        this.playbackState.addToPlaylist(mappedTracks, insertAt, {
          source,
          operator: payload.command === 'append' && source === 'radio_auto' ? 'system' : 'user',
          insertPolicy,
          reason: payload.reason,
        });

        if (payload.command === 'play_now') {
          this.playbackState.setCurrentIndex(insertAt);
          this.playbackState.updateState({ action: 'play' });
          shouldBroadcastNowPlaying = true;
        }

        broadcastAction = 'add';
        break;
      }

      case 'accept_candidate': {
        if (!payload.candidateId) {
          return { status: 'error', message: 'candidateId is required' };
        }
        const mode = payload.reason as 'play_now' | 'play_next' | 'append' | undefined;
        const accepted = this.playbackState.acceptCandidate(payload.candidateId, mode || 'append');
        if (!accepted) {
          return { status: 'error', message: 'Candidate not found' };
        }
        if (mode === 'play_now') {
          this.playbackState.updateState({ action: 'play' });
          shouldBroadcastNowPlaying = true;
        }
        broadcastAction = 'add';
        break;
      }

      case 'reject_candidate': {
        if (!payload.candidateId) {
          return { status: 'error', message: 'candidateId is required' };
        }
        const removed = this.playbackState.rejectCandidate(payload.candidateId);
        if (!removed) {
          return { status: 'error', message: 'Candidate not found' };
        }
        broadcastAction = 'replace';
        break;
      }

      case 'remove': {
        if (typeof payload.index !== 'number') {
          return { status: 'error', message: 'index is required' };
        }
        const removed = this.playbackState.removeFromPlaylist(payload.index);
        if (!removed) {
          return { status: 'error', message: 'Invalid queue index' };
        }
        broadcastAction = 'remove';
        break;
      }

      case 'clear_upcoming': {
        this.playbackState.clearUpcoming();
        broadcastAction = 'remove';
        break;
      }

      case 'move': {
        if (typeof payload.fromIndex !== 'number' || typeof payload.toIndex !== 'number') {
          return { status: 'error', message: 'fromIndex and toIndex are required' };
        }
        const moved = this.playbackState.moveTrack(payload.fromIndex, payload.toIndex);
        if (!moved) {
          return { status: 'error', message: 'Only upcoming tracks can be reordered' };
        }
        broadcastAction = 'replace';
        break;
      }
    }

    const queue = this.getQueueSnapshot();
    this.chatGateway.broadcastPlaylistUpdate({
      action: broadcastAction,
      playlist: queue.playlist,
      currentIndex: queue.currentIndex,
      source: payload.source === 'chat' ? 'chat' : payload.source || 'manual',
      queue,
    });

    if (shouldBroadcastNowPlaying) {
      const state = this.playbackState.getState();
      this.chatGateway.broadcastNowPlaying({
        action: 'play',
        content: state.content,
        position: state.position,
        currentIndex: state.currentIndex,
        queue,
      });
    }

    return { status: 'success', queue };
  }

  // ========== 播放状态 ==========

  @Get('api/now')
  async getNowPlaying() {
    return this.playbackState.getState();
  }

  @Post('api/control')
  @HttpCode(HttpStatus.OK)
  async control(
    @Body('command') command: string,
    @Body('payload') payload?: any,
  ) {
    let status: 'ok' | 'error' = 'ok';

    switch (command) {
      case 'play':
        if (this.playbackState.getState().action === 'pause') {
          this.playbackState.updateState({ action: 'play' });
        }
        break;
      case 'pause':
        this.playbackState.setPaused();
        break;
      case 'next':
        this.playbackState.nextTrack();
        break;
      case 'prev':
        this.playbackState.prevTrack();
        break;
      case 'seek':
        if (payload?.position !== undefined) {
          this.playbackState.seek(payload.position);
        }
        break;
      case 'volume':
        if (payload?.volume !== undefined) {
          this.playbackState.setVolume(payload.volume);
        }
        break;
      case 'shuffle':
        this.playbackState.updateState({ shuffle: payload?.shuffle ?? true });
        break;
      case 'repeat':
        this.playbackState.updateState({ repeat: payload?.repeat || 'off' });
        break;
      default:
        status = 'error';
    }

    const state = this.playbackState.getState();
    this.chatGateway.broadcastNowPlaying({
      action: command,
      content: state.content,
      position: state.position,
      currentIndex: state.currentIndex,
      queue: this.getQueueSnapshot(),
    });

    return { status, command, queue: this.getQueueSnapshot() };
  }

  @Get('api/queue')
  async getQueue() {
    return this.ensureQueueInitialized();
  }

  @Get('api/candidates')
  async getCandidates() {
    const queue = await this.ensureQueueInitialized();
    return queue.candidates;
  }

  @Post('api/queue/commands')
  @HttpCode(HttpStatus.OK)
  async queueCommands(
    @Body('command') command: 'play_now' | 'play_next' | 'append' | 'remove' | 'clear_upcoming' | 'accept_candidate' | 'reject_candidate' | 'move',
    @Body('track') track?: any,
    @Body('tracks') tracks?: any[],
    @Body('candidateId') candidateId?: string,
    @Body('index') index?: number,
    @Body('fromIndex') fromIndex?: number,
    @Body('toIndex') toIndex?: number,
    @Body('source') source?: QueueSource | 'chat',
    @Body('mode') mode?: 'play_now' | 'play_next' | 'append',
  ) {
    return this.runQueueCommand({
      command,
      track,
      tracks,
      candidateId,
      index,
      fromIndex,
      toIndex,
      source,
      reason: command === 'accept_candidate' ? mode : undefined,
    });
  }

  @Post('api/candidates/:id/accept')
  @HttpCode(HttpStatus.OK)
  async acceptCandidate(
    @Param('id') id: string,
    @Body('mode') mode?: 'play_now' | 'play_next' | 'append',
  ) {
    return this.runQueueCommand({
      command: 'accept_candidate',
      candidateId: id,
      reason: mode,
      source: 'manual',
    });
  }

  @Post('api/candidates/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectCandidate(@Param('id') id: string) {
    return this.runQueueCommand({
      command: 'reject_candidate',
      candidateId: id,
      source: 'manual',
    });
  }

  @Post('api/queue/add')
  @HttpCode(HttpStatus.OK)
  async addQueueTrack(
    @Body('track') track?: any,
    @Body('tracks') tracks?: any[],
    @Body('insertAt') insertAt?: number,
    @Body('playNow') playNow?: boolean,
    @Body('source') source?: 'manual' | 'chat' | 'radio_auto',
  ) {
    const command = playNow ? 'play_now' : typeof insertAt === 'number' ? 'play_next' : 'append';
    return this.runQueueCommand({
      command,
      track,
      tracks,
      source,
    });
  }

  @Post('api/queue/select')
  @HttpCode(HttpStatus.OK)
  async selectQueueTrack(@Body('index') index: number) {
    const queue = await this.ensureQueueInitialized();
    if (typeof index !== 'number' || index < 0 || index >= queue.playlist.length) {
      return { status: 'error', message: 'Invalid queue index' };
    }

    this.playbackState.setCurrentIndex(index);
    this.playbackState.updateState({ action: 'play' });

    const state = this.playbackState.getState();
    const snapshot = this.getQueueSnapshot();
    this.chatGateway.broadcastNowPlaying({
      action: 'play',
      content: state.content,
      position: state.position,
      currentIndex: state.currentIndex,
      queue: snapshot,
    });

    return { status: 'success', queue: snapshot };
  }

  @Post('api/queue/remove')
  @HttpCode(HttpStatus.OK)
  async removeQueueTrack(@Body('index') index: number) {
    return this.runQueueCommand({
      command: 'remove',
      index,
      source: 'manual',
    });
  }

  @Post('api/queue/clear-upcoming')
  @HttpCode(HttpStatus.OK)
  async clearUpcoming() {
    return this.runQueueCommand({
      command: 'clear_upcoming',
      source: 'manual',
    });
  }

  // ========== 网易云登录 ==========

  @Post('api/cookie')
  async setCookie(@Body('cookie') cookie: string) {
    if (!cookie || typeof cookie !== 'string') {
      return { status: 'error', message: 'Cookie is required' };
    }
    this.stateService.setCookie(cookie);
    return { status: 'success' };
  }

  @Post('api/send-captcha')
  async sendCaptcha(@Body('phone') phone: string, @Body('countrycode') countrycode?: string) {
    if (!phone || typeof phone !== 'string') {
      return { status: 'error', message: 'Phone number is required' };
    }
    try {
      await this.musicService.sendCaptcha(phone, countrycode || '86');
      return { status: 'success' };
    } catch {
      return { status: 'error', message: 'Failed to send captcha' };
    }
  }

  @Post('api/login')
  async login(
    @Body('phone') phone: string,
    @Body('captcha') captcha: string,
    @Body('countrycode') countrycode?: string,
  ) {
    if (!phone || !captcha) {
      return { status: 'error', message: 'Phone and captcha are required' };
    }
    try {
      const result = await this.musicService.loginWithCaptcha(phone, captcha, countrycode || '86');
      return { status: 'success', ...result };
    } catch {
      return { status: 'error', message: 'Login failed' };
    }
  }

  @Post('api/logout')
  async logout() {
    this.stateService.setCookie('');
    return { status: 'success' };
  }

  @Get('api/login-status')
  async loginStatus() {
    const cookie = this.stateService.getCookie();
    return { loggedIn: !!cookie };
  }

  // ========== 用户品味 ==========

  @Get('api/taste')
  async getTaste() {
    return this.tasteService.getTaste();
  }

  // ========== 测试 ==========

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('test-music')
  async testMusic() {
    return await this.musicService.getRecommendSongs();
  }

  @Get('api/lyric/:id')
  async getLyric(@Param('id') id: string) {
    try {
      const data: any = await this.musicService.getLyric(id);
      return { lyric: data?.lrc?.lyric || '' };
    } catch {
      return { lyric: '' };
    }
  }

  // ========== 播放列表 ==========

  @Get('playlist')
  async getPlaylist() {
    const queue = await this.ensureQueueInitialized();
    return queue.playlist;
  }

  // ========== 音频流 ==========

  @Get('audio/:id')
  async streamAudio(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    let urls: any = await this.musicService.getSongUrl(id);
    let songUrl = Array.isArray(urls) ? urls.find((item: any) => item?.url)?.url : urls?.[0]?.url;

    if (!songUrl) {
      return res.status(404).json({ error: 'Audio source not found' });
    }

    let response = await fetch(songUrl, {
      headers: range ? { Range: range } : undefined,
    });

    if ((response.status === 403 || response.status === 404) && !response.ok) {
      console.log(`Audio URL expired for ${id}, refreshing and retrying...`);
      try {
        urls = await this.musicService.refreshSongUrl(id);
        songUrl = Array.isArray(urls) ? urls.find((item: any) => item?.url)?.url : urls?.[0]?.url;
        if (songUrl) {
          response = await fetch(songUrl, {
            headers: range ? { Range: range } : undefined,
          });
        }
      } catch {
        // retry failed, use original response
      }
    }

    if (!response.ok || !response.body) {
      return res.status(response.status).json({ error: 'Failed to fetch audio source' });
    }

    const headersToForward = ['content-type', 'content-length', 'accept-ranges', 'content-range', 'cache-control', 'last-modified', 'etag'];

    headersToForward.forEach((headerName) => {
      const headerValue = response.headers.get(headerName);
      if (headerValue) {
        res.setHeader(headerName, headerValue);
      }
    });

    res.status(response.status);

    const webStream = response.body as any;
    const nodeStream = typeof webStream?.pipe === 'function' ? webStream : undefined;

    if (nodeStream) {
      return nodeStream.pipe(res);
    }

    const reader = response.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        res.write(Buffer.from(value));
      }
      res.end();
    };

    await pump();
  }
}
